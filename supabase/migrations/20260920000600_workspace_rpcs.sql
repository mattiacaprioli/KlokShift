-- Baseline — 7/N: RPC di workspace e sedi.
--
-- Convenzioni di tutte le RPC di scrittura (da qui in poi):
--   * `security definer`, `set search_path = ''`, EXECUTE solo ad authenticated;
--   * l'autorizzazione è la PRIMA cosa che si controlla, con gli helper di
--     `private` (mai un `owner_id = auth.uid()` scritto a mano);
--   * un errore è un `raise exception '<codice>'` con codice snake_case (il client
--     lo traduce in src/lib/errors.ts); non esiste un no-op silenzioso: se la
--     riga non c'è o non è tua, si solleva.

-- ---------------------------------------------------------------------------
-- Chi sono e dove: sostituisce profile.role, getMyVenueAccess, getMyEmployers e
-- getMyPendingInvites con una sola chiamata.
-- ---------------------------------------------------------------------------
-- Una riga per appartenenza (anche `invited`, così l'invito da accettare si vede).
-- `venues` = le sedi che gestisco con i permessi su ciascuna; `works` = le sedi in
-- cui lavoro. Il client ricava da qui le «viste» (gestione / lavoro), non da un
-- ruolo scritto sul profilo.
create function public.get_my_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  return jsonb_build_object(
    'user_id', v_uid,
    'memberships', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'member_id',      m.id,
          'workspace_id',   m.workspace_id,
          'workspace_name', w.name,
          'plan',           w.plan,
          'authority',      m.authority,
          'status',         m.status,
          'display_name',   m.display_name,
          'scope',          m.scope,
          'perms', jsonb_build_object(
            'shifts',    m.authority = 'owner' or m.can_shifts,
            'staff',     m.authority = 'owner' or m.can_staff,
            'hours',     m.authority = 'owner' or m.can_hours,
            'documents', m.authority = 'owner' or m.can_documents,
            'venue',     m.authority = 'owner' or m.can_venue
          ),
          'venues', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', v.id, 'name', v.name, 'city', v.city, 'closed_at', v.closed_at,
                'logo_url', v.logo_url, 'perms', to_jsonb(g.perms)
              ) order by v.name
            )
              from private.member_venue_grants g
              join public.venues v on v.id = g.venue_id
             where g.member_id = m.id
          ), '[]'::jsonb),
          'works', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'venue_member_id', vm.id, 'venue_id', vm.venue_id, 'venue_name', v.name,
                'employment_type', vm.employment_type
              ) order by v.name
            )
              from public.venue_members vm
              join public.venues v on v.id = vm.venue_id
             where vm.member_id = m.id and vm.left_at is null
          ), '[]'::jsonb)
        )
        order by w.name
      )
        from public.workspace_members m
        join public.workspaces w on w.id = m.workspace_id and w.deleted_at is null
       where m.user_id = v_uid and m.status <> 'left'
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Azienda
-- ---------------------------------------------------------------------------
-- Qualunque account può aprirne una: diventa titolare. Il tetto evita che un
-- loop nel client (o un abuso) riempia la tabella.
create function public.create_workspace(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := (select auth.uid());
  v_ws   uuid;
  v_name text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'name_required' using errcode = '23514';
  end if;
  if (select count(*) from public.workspaces w
       where w.created_by = v_uid and w.deleted_at is null) >= 10 then
    raise exception 'workspace_limit' using errcode = '23514';
  end if;

  -- Rete di sicurezza: il profilo di norma lo ha già creato il trigger su auth.users.
  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;

  insert into public.workspaces (name, created_by) values (btrim(p_name), v_uid)
  returning id into v_ws;

  select coalesce(nullif(btrim(p.full_name), ''), 'Titolare') into v_name
    from public.profiles p where p.id = v_uid;

  insert into public.workspace_members (workspace_id, user_id, display_name, authority, status)
  values (v_ws, v_uid, v_name, 'owner', 'active');

  return v_ws;
end;
$$;

-- Passa la titolarità a un altro membro (attivo, con un account). Chi la cede
-- resta come collaboratore con tutti i permessi: nessuno perde l'accesso di colpo.
-- Promozione e retrocessione stanno nella stessa transazione, quindi il trigger
-- «almeno un titolare» (differito) non vede mai un'azienda senza.
create function public.transfer_ownership(p_workspace uuid, p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_me     uuid;
  v_target record;
  v_ws     text;
begin
  select m.id into v_me
    from public.workspace_members m
   where m.workspace_id = p_workspace and m.user_id = v_uid
     and m.authority = 'owner' and m.status = 'active';
  if v_me is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select m.id, m.user_id into v_target
    from public.workspace_members m
   where m.id = p_member and m.workspace_id = p_workspace
     and m.status = 'active' and m.user_id is not null and m.id <> v_me;
  if v_target.id is null then
    raise exception 'invalid_target' using errcode = '23514';
  end if;

  update public.workspace_members
     set authority = 'owner', scope = 'all',
         can_shifts = false, can_staff = false, can_hours = false,
         can_documents = false, can_venue = false
   where id = v_target.id;

  update public.workspace_members
     set authority = 'collaborator', scope = 'all',
         can_shifts = true, can_staff = true, can_hours = true,
         can_documents = true, can_venue = true
   where id = v_me;

  select w.name into v_ws from public.workspaces w where w.id = p_workspace;
  perform private.notify(
    v_target.user_id, 'team_linked', 'Sei il nuovo titolare',
    'Ora sei il titolare di ' || v_ws || '.', p_workspace
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Sedi
-- ---------------------------------------------------------------------------
create function public.create_venue(
  p_workspace uuid, p_name text,
  p_address text default null, p_city text default null, p_cuisine_type text default null,
  p_logo_url text default null, p_description text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not private.owns_workspace(p_workspace) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'name_required' using errcode = '23514';
  end if;

  insert into public.venues (workspace_id, name, address, city, cuisine_type, logo_url, description)
  values (p_workspace, btrim(p_name), p_address, p_city, p_cuisine_type, p_logo_url, p_description)
  returning id into v_id;
  return v_id;
end;
$$;

-- Chiudere una sede non la cancella: restano turni, ore e storico.
create function public.set_venue_closed(p_venue uuid, p_closed boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.owns_workspace(private.venue_workspace(p_venue)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.venues
     set closed_at = case when p_closed then coalesce(closed_at, now()) else null end
   where id = p_venue;
end;
$$;

grant execute on function
  public.get_my_context(),
  public.create_workspace(text),
  public.transfer_ownership(uuid, uuid),
  public.create_venue(uuid, text, text, text, text, text, text),
  public.set_venue_closed(uuid, boolean)
to authenticated;
