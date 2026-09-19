-- Baseline — 8/N: RPC dei membri.
--
-- `add_member` è l'UNICA porta d'ingresso: sostituisce le sei funzioni client
-- (addStaff, addStaffToVenues, addTeamMember, addTeamVenue, promoteStaffPerson,
-- addSelfToStaff) che facevano 4-7 round trip non atomici, e i tre `find_*` per
-- email. Il risultato dice cosa è successo, così il client non lo indovina.

-- ---------------------------------------------------------------------------
-- Interni
-- ---------------------------------------------------------------------------
-- Sostituisce le mansioni di una riga di organico. Le mansioni devono essere di
-- quella sede (la FK composita lo garantirebbe, ma con un errore illeggibile).
create function private.replace_roles(p_venue_member uuid, p_role_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_venue uuid;
  v_ids   uuid[] := coalesce(p_role_ids, '{}');
begin
  select vm.venue_id into v_venue from public.venue_members vm where vm.id = p_venue_member;
  if exists (
    select 1 from unnest(v_ids) r
     where not exists (select 1 from public.venue_roles vr where vr.id = r and vr.venue_id = v_venue)
  ) then
    raise exception 'role_not_in_venue' using errcode = '23514';
  end if;

  delete from public.venue_member_roles
   where venue_member_id = p_venue_member and role_id <> all (v_ids);
  insert into public.venue_member_roles (venue_member_id, venue_id, role_id)
  select p_venue_member, v_venue, r from unnest(v_ids) r
  on conflict do nothing;
end;
$$;

-- Mette (o rimette) una persona in organico in una sede. Chiama chi ha «Staff»
-- su quella sede; il titolare passa dalla stessa strada perché ha ogni permesso.
create function private.place_member(
  p_member uuid, p_workspace uuid, p_venue uuid,
  p_employment public.employment_type, p_role_ids uuid[], p_set_roles boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_vm uuid;
begin
  if private.venue_workspace(p_venue) is distinct from p_workspace then
    raise exception 'venue_not_in_workspace' using errcode = '42501';
  end if;
  if not private.can(p_venue, 'staff') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  insert into public.venue_members (member_id, venue_id, workspace_id, employment_type)
  values (p_member, p_venue, p_workspace, p_employment)
  on conflict (member_id, venue_id) do update
    set left_at = null, employment_type = excluded.employment_type
  returning id into v_vm;

  if p_set_roles then
    perform private.replace_roles(v_vm, p_role_ids);
  end if;
  return v_vm;
end;
$$;

-- Imposta authority, permessi e ambito di un membro. Solo per collaboratore e
-- «nessuno»: la titolarità passa da transfer_ownership.
create function private.apply_access(
  p_member uuid, p_authority public.member_authority, p_perms jsonb,
  p_scope public.venue_scope, p_scope_venues uuid[]
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid;
begin
  if p_authority = 'owner' then
    raise exception 'use_transfer_ownership' using errcode = '23514';
  end if;
  select workspace_id into v_ws from public.workspace_members where id = p_member;

  if p_authority = 'collaborator' then
    update public.workspace_members set
      authority     = 'collaborator',
      can_shifts    = coalesce((p_perms ->> 'shifts')::boolean, false),
      can_staff     = coalesce((p_perms ->> 'staff')::boolean, false),
      can_hours     = coalesce((p_perms ->> 'hours')::boolean, false),
      can_documents = coalesce((p_perms ->> 'documents')::boolean, false),
      can_venue     = coalesce((p_perms ->> 'venue')::boolean, false),
      scope         = p_scope
    where id = p_member;
  else
    update public.workspace_members set
      authority = 'none',
      can_shifts = false, can_staff = false, can_hours = false,
      can_documents = false, can_venue = false, scope = 'all'
    where id = p_member;
  end if;

  delete from public.member_scope where member_id = p_member;
  if p_authority = 'collaborator' and p_scope = 'selected' then
    insert into public.member_scope (member_id, venue_id, workspace_id)
    select p_member, v, v_ws from unnest(coalesce(p_scope_venues, '{}')) v
    on conflict do nothing;
  end if;
end;
$$;

-- Congeda un membro da tutta l'azienda: uscito da ogni sede, senza poteri.
-- I turni futuri li libera il trigger su venue_members (left_at).
create function private.leave_workspace(p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.venue_members set left_at = now()
   where member_id = p_member and left_at is null;

  update public.workspace_members set
    status = 'left', left_at = now(),
    authority = 'none', scope = 'all',
    can_shifts = false, can_staff = false, can_hours = false,
    can_documents = false, can_venue = false
  where id = p_member;

  delete from public.member_scope where member_id = p_member;
  delete from public.member_invites where member_id = p_member;
end;
$$;

-- ---------------------------------------------------------------------------
-- add_member
-- ---------------------------------------------------------------------------
-- p_person: {full_name, email?, phone?, note?, contract_hours?, contract_period?}
-- p_venues: [{venue_id, employment_type?, role_ids?, in_scope?}]
-- p_self:   true = «metti me stesso in organico»: nessuna persona nuova, si
--           aggiungono righe di organico alla mia appartenenza. Il consenso è il
--           gesto stesso.
--
-- Esito: created_manual | invited_in_app | invite_email | already_member | self.
--   invited_in_app  l'email è di un account esistente: deve accettare (consenso).
--   invite_email    nessun account: il client chiede alla Edge Function di
--                   mandare l'email (dipendente: «registrati con questo
--                   indirizzo»; collaboratore: link con token monouso).
--
-- Regole: authority ≠ none solo per il titolare; chi ha «Staff» aggiunge solo
-- dipendenti, solo nelle sue sedi. Nessuno concede un permesso che non ha
-- perché solo il titolare può concederne.
create function public.add_member(
  p_workspace uuid,
  p_person    jsonb default '{}'::jsonb,
  p_authority public.member_authority default 'none',
  p_perms     jsonb default '{}'::jsonb,
  p_scope     public.venue_scope default 'all',
  p_venues    jsonb default '[]'::jsonb,
  p_self      boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_owner   boolean;
  v_name    text := nullif(btrim(coalesce(p_person ->> 'full_name', '')), '');
  v_email   text := nullif(lower(btrim(coalesce(p_person ->> 'email', ''))), '');
  v_member  uuid;
  v_user    uuid;
  v_outcome text;
  v_ws_name text;
  v_scope_venues uuid[] := '{}';
  v_vms     uuid[] := '{}';
  v_item    jsonb;
  v_vm      uuid;
  v_found   record;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.manages_workspace(p_workspace) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  v_owner := private.owns_workspace(p_workspace);
  select w.name into v_ws_name from public.workspaces w where w.id = p_workspace;

  if p_self then
    select m.id into v_member
      from public.workspace_members m
     where m.workspace_id = p_workspace and m.user_id = v_uid and m.status = 'active';
    v_outcome := 'self';
  else
    if p_authority = 'owner' then
      raise exception 'use_transfer_ownership' using errcode = '23514';
    end if;
    if p_authority <> 'none' and not v_owner then
      raise exception 'owner_only' using errcode = '42501';
    end if;
    if v_name is null then
      raise exception 'name_required' using errcode = '23514';
    end if;
    if not v_owner and jsonb_array_length(coalesce(p_venues, '[]'::jsonb)) = 0 then
      raise exception 'venues_required' using errcode = '23514';
    end if;

    -- Stessa scheda già in azienda? Per email, poi per account.
    if v_email is not null then
      select m.id, m.status, m.user_id into v_found
        from public.workspace_members m
       where m.workspace_id = p_workspace and lower(m.email) = v_email;
      v_member := v_found.id;
    end if;

    if v_member is not null then
      if v_found.status = 'left' then
        -- Chi torna nell'azienda passa dal consenso, se ha un account.
        update public.workspace_members
           set status = case when user_id is not null or p_authority <> 'none' then 'invited' else 'active' end,
               left_at = null, display_name = v_name
         where id = v_member;
        v_outcome := case when v_found.user_id is not null then 'invited_in_app' else 'invite_email' end;
      else
        v_outcome := 'already_member';
      end if;
    else
      if v_email is not null then
        select u.id into v_user from auth.users u
         where lower(u.email) = v_email and u.email_confirmed_at is not null
         order by u.created_at limit 1;
      end if;

      if v_user is not null then
        select m.id into v_member from public.workspace_members m
         where m.workspace_id = p_workspace and m.user_id = v_user;
        if v_member is not null then
          v_outcome := 'already_member';
        end if;
      end if;

      if v_member is null then
        if p_authority <> 'none' and v_email is null and v_user is null then
          raise exception 'email_required' using errcode = '23514';
        end if;

        insert into public.workspace_members (
          workspace_id, user_id, email, display_name, phone, authority, status
        ) values (
          p_workspace, v_user, v_email, v_name, nullif(btrim(coalesce(p_person ->> 'phone', '')), ''),
          'none',
          case when v_user is not null or p_authority <> 'none'
               then 'invited'::public.member_status else 'active'::public.member_status end
        ) returning id into v_member;
        -- authority e permessi li applica apply_access, un posto solo.

        v_outcome := case
          when v_user is not null then 'invited_in_app'
          when v_email is not null then 'invite_email'
          else 'created_manual'
        end;
      end if;
    end if;

    if p_authority <> 'none' and v_outcome <> 'already_member' then
      perform private.apply_access(v_member, p_authority, p_perms, p_scope, '{}');
    end if;

    if p_person ? 'note' or p_person ? 'contract_hours' then
      insert into public.member_hr (member_id, note, contract_hours, contract_period)
      values (
        v_member, nullif(btrim(coalesce(p_person ->> 'note', '')), ''),
        (p_person ->> 'contract_hours')::numeric, p_person ->> 'contract_period'
      )
      on conflict (member_id) do update
        set note = excluded.note, contract_hours = excluded.contract_hours,
            contract_period = excluded.contract_period;
    end if;

    if v_outcome = 'invited_in_app' then
      perform private.notify(
        v_user, 'staff_invite',
        case when p_authority = 'none' then 'Invito da ' || v_ws_name else 'Invito a collaborare' end,
        case when p_authority = 'none'
             then v_ws_name || ' ti ha aggiunto al suo organico. Accetta per vedere i tuoi turni.'
             else v_ws_name || ' ti invita a collaborare alla gestione.' end,
        v_member
      );
    end if;
  end if;

  if v_member is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  -- Righe di organico. Tutto nella stessa transazione: se una sede è sbagliata,
  -- non resta una persona a metà.
  for v_item in select * from jsonb_array_elements(coalesce(p_venues, '[]'::jsonb)) loop
    v_vm := private.place_member(
      v_member, p_workspace, (v_item ->> 'venue_id')::uuid,
      coalesce((v_item ->> 'employment_type')::public.employment_type, 'a_chiamata'),
      case when v_item ? 'role_ids'
           then array(select r::uuid from jsonb_array_elements_text(v_item -> 'role_ids') r) end,
      v_item ? 'role_ids'
    );
    v_vms := v_vms || v_vm;
    if coalesce((v_item ->> 'in_scope')::boolean, false) then
      v_scope_venues := v_scope_venues || (v_item ->> 'venue_id')::uuid;
    end if;
  end loop;

  if p_authority = 'collaborator' and p_scope = 'selected' and not p_self and v_outcome <> 'already_member' then
    perform private.apply_access(v_member, p_authority, p_perms, p_scope, v_scope_venues);
  end if;

  return jsonb_build_object(
    'member_id', v_member, 'outcome', v_outcome, 'venue_member_ids', to_jsonb(v_vms)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- update_member
-- ---------------------------------------------------------------------------
-- p_patch: qualunque di {display_name, phone, email, note, contract_hours,
-- contract_period}. La chiave assente non si tocca; presente e null la svuota.
-- L'email si cambia solo finché la scheda non ha un account.
create function public.update_member(p_member uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_m    record;
  v_hr   record;
  v_hr_keys boolean := (p_patch ? 'note') or (p_patch ? 'contract_hours') or (p_patch ? 'contract_period');
begin
  if not private.can_person(p_member, 'staff') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- Chi non è titolare non decide sui propri dati di contratto.
  if v_hr_keys and private.is_restricted_self(p_member) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select m.user_id into v_m from public.workspace_members m where m.id = p_member;
  if (p_patch ? 'email') and v_m.user_id is not null then
    raise exception 'email_locked' using errcode = '23514';
  end if;

  update public.workspace_members m set
    display_name = case when p_patch ? 'display_name'
                        then coalesce(nullif(btrim(p_patch ->> 'display_name'), ''), m.display_name)
                        else m.display_name end,
    phone = case when p_patch ? 'phone' then nullif(btrim(coalesce(p_patch ->> 'phone', '')), '') else m.phone end,
    email = case when p_patch ? 'email' then nullif(lower(btrim(coalesce(p_patch ->> 'email', ''))), '') else m.email end
  where m.id = p_member;

  if v_hr_keys then
    select h.note, h.contract_hours, h.contract_period into v_hr
      from public.member_hr h where h.member_id = p_member;
    insert into public.member_hr (member_id, note, contract_hours, contract_period)
    values (
      p_member,
      case when p_patch ? 'note' then nullif(btrim(coalesce(p_patch ->> 'note', '')), '') else v_hr.note end,
      case when p_patch ? 'contract_hours' then (p_patch ->> 'contract_hours')::numeric else v_hr.contract_hours end,
      case when p_patch ? 'contract_period' then p_patch ->> 'contract_period' else v_hr.contract_period end
    )
    on conflict (member_id) do update
      set note = excluded.note, contract_hours = excluded.contract_hours,
          contract_period = excluded.contract_period;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_member_access — solo il titolare
-- ---------------------------------------------------------------------------
-- Promuove un dipendente a collaboratore, cambia permessi e ambito, o toglie i
-- poteri. Chi non ha (ancora) un account non può riceverli: senza auth.uid() non
-- ci sarebbe niente a cui agganciarli.
create function public.set_member_access(
  p_member uuid, p_authority public.member_authority,
  p_perms jsonb default '{}'::jsonb, p_scope public.venue_scope default 'all',
  p_scope_venues uuid[] default '{}'
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_m record;
  v_ws text;
begin
  select m.workspace_id, m.authority, m.user_id, m.status into v_m
    from public.workspace_members m where m.id = p_member;
  if v_m.workspace_id is null or not private.owns_workspace(v_m.workspace_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_m.authority = 'owner' or p_authority = 'owner' then
    raise exception 'use_transfer_ownership' using errcode = '23514';
  end if;
  if p_authority = 'collaborator' and (v_m.user_id is null or v_m.status <> 'active') then
    raise exception 'needs_account' using errcode = '23514';
  end if;

  perform private.apply_access(p_member, p_authority, p_perms, p_scope, p_scope_venues);

  select w.name into v_ws from public.workspaces w where w.id = v_m.workspace_id;
  if v_m.authority = 'none' and p_authority = 'collaborator' then
    perform private.notify(v_m.user_id, 'team_linked', 'Ora collabori alla gestione',
      'Puoi gestire ' || v_ws || ' con i permessi che ti sono stati dati.', p_member);
  elsif v_m.authority = 'collaborator' and p_authority = 'none' then
    perform private.notify(v_m.user_id, 'team_removed', 'Accesso alla gestione tolto',
      'Non gestisci più ' || v_ws || '.', p_member);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organico: sedi e mansioni
-- ---------------------------------------------------------------------------
create function public.set_member_venue(
  p_member uuid, p_venue uuid, p_employment_type public.employment_type default 'a_chiamata',
  p_role_ids uuid[] default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_m record;
begin
  select m.workspace_id, m.status into v_m from public.workspace_members m where m.id = p_member;
  if v_m.workspace_id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_m.status = 'left' then
    raise exception 'member_left' using errcode = '23514';
  end if;
  return private.place_member(p_member, v_m.workspace_id, p_venue, p_employment_type, p_role_ids, p_role_ids is not null);
end;
$$;

create function public.set_member_roles(p_venue_member uuid, p_role_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_venue uuid;
begin
  select vm.venue_id into v_venue from public.venue_members vm where vm.id = p_venue_member;
  if v_venue is null or not private.can(v_venue, 'staff') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.replace_roles(p_venue_member, p_role_ids);
end;
$$;

-- ---------------------------------------------------------------------------
-- Uscite
-- ---------------------------------------------------------------------------
-- remove_member(m)        toglie la persona dall'azienda
-- remove_member(m, sede)  la toglie da una sede sola
-- Il titolare non esce dall'azienda (si passa la titolarità), ma può togliersi
-- dall'organico di una sede. Chi non è titolare non toglie sé stesso: esce con
-- leave(). Il collaboratore lo rimuove solo il titolare.
create function public.remove_member(p_member uuid, p_venue uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_m    record;
  v_ws   text;
begin
  select m.workspace_id, m.authority, m.user_id into v_m
    from public.workspace_members m where m.id = p_member;
  if v_m.workspace_id is null or private.is_restricted_self(p_member) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if p_venue is not null then
    if not private.can(p_venue, 'staff') or private.venue_workspace(p_venue) is distinct from v_m.workspace_id then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    update public.venue_members set left_at = now()
     where member_id = p_member and venue_id = p_venue and left_at is null;
    if found then
      perform private.notify(v_m.user_id, 'staff_removed', 'Tolto dalla sede',
        'Non fai più parte dell''organico di '
          || (select v.name from public.venues v where v.id = p_venue) || '.', p_venue);
    end if;
    return;
  end if;

  if v_m.authority = 'owner' then
    raise exception 'owner_cannot_be_removed' using errcode = '23514';
  end if;
  if v_m.authority = 'collaborator' then
    if not private.owns_workspace(v_m.workspace_id) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
  elsif not (
    private.owns_workspace(v_m.workspace_id)
    or (
      private.can_person(p_member, 'staff')
      and not exists (
        select 1 from public.venue_members vm
         where vm.member_id = p_member and vm.left_at is null
           and vm.venue_id not in (select private.venues_where('staff'))
      )
    )
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  perform private.leave_workspace(p_member);

  select w.name into v_ws from public.workspaces w where w.id = v_m.workspace_id;
  perform private.notify(v_m.user_id, 'staff_removed', 'Collaborazione terminata',
    'Non fai più parte dell''organico di ' || v_ws || '.', v_m.workspace_id);
end;
$$;

-- Esco io. Da una sede o da tutta l'azienda.
create function public.leave(p_member uuid, p_venue uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_m    record;
  v_who  text;
  v_owner uuid;
begin
  select m.workspace_id, m.authority, m.display_name into v_m
    from public.workspace_members m
   where m.id = p_member and m.user_id = (select auth.uid()) and m.status <> 'left';
  if v_m.workspace_id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  v_who := v_m.display_name;

  if p_venue is not null then
    update public.venue_members set left_at = now()
     where member_id = p_member and venue_id = p_venue and left_at is null;
    perform private.notify_managers(p_venue, 'staff', 'staff_response', 'Un professionista ha lasciato la sede',
      v_who || ' ha lasciato la sede.', p_member);
    return;
  end if;

  if v_m.authority = 'owner' then
    raise exception 'owner_cannot_leave' using errcode = '23514';
  end if;

  perform private.leave_workspace(p_member);
  for v_owner in
    select m.user_id from public.workspace_members m
     where m.workspace_id = v_m.workspace_id and m.authority = 'owner'
       and m.status = 'active' and m.user_id is not null
  loop
    perform private.notify(v_owner, 'staff_response', 'Un professionista ha lasciato',
      v_who || ' ha lasciato l''organico.', p_member);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invito ricevuto
-- ---------------------------------------------------------------------------
create function public.respond_to_invite(p_member uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_m     record;
  v_owner uuid;
begin
  select m.workspace_id, m.display_name, m.authority into v_m
    from public.workspace_members m
   where m.id = p_member and m.user_id = (select auth.uid()) and m.status = 'invited';
  if v_m.workspace_id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if p_accept then
    update public.workspace_members set status = 'active', left_at = null where id = p_member;
  else
    perform private.leave_workspace(p_member);
  end if;

  for v_owner in
    select m.user_id from public.workspace_members m
     where m.workspace_id = v_m.workspace_id and m.authority = 'owner'
       and m.status = 'active' and m.user_id is not null
  loop
    perform private.notify(v_owner, 'staff_response',
      case when p_accept then 'Invito accettato' else 'Invito rifiutato' end,
      v_m.display_name || case when p_accept then ' ha accettato l''invito.' else ' ha rifiutato l''invito.' end,
      p_member);
  end loop;
end;
$$;

grant execute on function
  public.add_member(uuid, jsonb, public.member_authority, jsonb, public.venue_scope, jsonb, boolean),
  public.update_member(uuid, jsonb),
  public.set_member_access(uuid, public.member_authority, jsonb, public.venue_scope, uuid[]),
  public.set_member_venue(uuid, uuid, public.employment_type, uuid[]),
  public.set_member_roles(uuid, uuid[]),
  public.remove_member(uuid, uuid),
  public.leave(uuid, uuid),
  public.respond_to_invite(uuid, boolean)
to authenticated;
