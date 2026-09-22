-- add_member può risolvere una scheda già esistente tramite email. Applica
-- quindi ai dati HR la stessa regola di update_member: un collaboratore non
-- decide su sé stesso, mentre il titolare può farlo. Le chiavi HR assenti non
-- cancellano valori già presenti quando si aggiunge la persona a un'altra sede.
create or replace function public.add_member(
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
  v_hr      record;
  v_hr_keys boolean := (p_person ? 'note') or (p_person ? 'contract_hours') or (p_person ? 'contract_period');
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

    if v_email is not null then
      select m.id, m.status, m.user_id into v_found
        from public.workspace_members m
       where m.workspace_id = p_workspace and lower(m.email) = v_email;
      v_member := v_found.id;
    end if;

    if v_member is not null then
      if v_found.status = 'left' then
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

    if v_hr_keys then
      if private.is_restricted_self(v_member) then
        raise exception 'not_allowed' using errcode = '42501';
      end if;

      select h.note, h.contract_hours, h.contract_period into v_hr
        from public.member_hr h where h.member_id = v_member;
      insert into public.member_hr (member_id, note, contract_hours, contract_period)
      values (
        v_member,
        case when p_person ? 'note' then nullif(btrim(coalesce(p_person ->> 'note', '')), '') else v_hr.note end,
        case when p_person ? 'contract_hours' then (p_person ->> 'contract_hours')::numeric else v_hr.contract_hours end,
        case when p_person ? 'contract_period' then p_person ->> 'contract_period' else v_hr.contract_period end
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
