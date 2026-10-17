-- La card della sede nel profilo del professionista mostrava solo le
-- iniziali: `get_my_context` dava il logo per le sedi che si **gestiscono**
-- (`venues`) ma non per quelle in cui si **lavora** (`works`). Stessa
-- funzione, con `logo_url` anche in `works`. Chi lavora in una sede la legge
-- già (nome, indirizzo, logo sui turni): nessun dato nuovo esce.

create or replace function public.get_my_context()
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
                'employment_type', vm.employment_type, 'logo_url', v.logo_url
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
