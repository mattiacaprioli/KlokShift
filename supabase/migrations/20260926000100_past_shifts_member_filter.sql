-- Storico del gestore: filtro per persona.
--
-- Un turno passa il filtro se una delle persone scelte (`workspace_members.id`)
-- ci è assegnata, in una qualsiasi delle sue sedi. Il rifiuto non conta: chi ha
-- detto di no non ha fatto quel turno. Il no-show sì: è un turno suo, da
-- rivedere proprio guardando la persona.
--
-- La firma cambia, quindi le funzioni si ricreano invece di un `create or
-- replace`: due overload con gli stessi nomi di argomento renderebbero ambigua
-- la chiamata PostgREST. Il nuovo parametro ha default `null`, così i client già
-- pubblicati (argomenti per nome) continuano a funzionare.

drop function public.get_owner_past_shifts_page(uuid[], integer, date, time, uuid, date, date, text, uuid[], text);
drop function public.get_owner_past_shifts_count(uuid[], date, date, text, uuid[], text);
drop function private.owner_past_shift_matches(public.shifts, uuid[], date, date, text, uuid[], text);

create function private.owner_past_shift_matches(
  p_shift public.shifts,
  p_venue_ids uuid[],
  p_from date,
  p_to date,
  p_status text,
  p_role_ids uuid[],
  p_query text,
  p_member_ids uuid[]
)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    p_shift.venue_id = any(coalesce(p_venue_ids, '{}'::uuid[]))
    and p_shift.venue_id in (select private.venues_where('roster'))
    and public.shift_ends_at(
      p_shift.date,
      p_shift.start_time,
      p_shift.end_time
    ) <= public.local_now()
    and (p_from is null or p_shift.date >= p_from)
    and (p_to is null or p_shift.date <= p_to)
    and case coalesce(p_status, 'all')
          when 'cancelled' then p_shift.status = 'cancelled'
          when 'done' then p_shift.status <> 'cancelled'
          else true
        end
    and (
      coalesce(cardinality(p_role_ids), 0) = 0
      or exists (
        select 1
          from public.shift_role_requirements r
         where r.shift_id = p_shift.id
           and r.role_id = any(p_role_ids)
      )
    )
    and (
      coalesce(cardinality(p_member_ids), 0) = 0
      or exists (
        select 1
          from public.shift_assignments a
          join public.venue_members vm on vm.id = a.venue_member_id
         where a.shift_id = p_shift.id
           and a.status <> 'declined'
           and vm.member_id = any(p_member_ids)
      )
    )
    and (
      nullif(btrim(p_query), '') is null
      or p_shift.title ilike ('%' || btrim(p_query) || '%')
    );
$$;

create function public.get_owner_past_shifts_page(
  p_venue_ids uuid[],
  p_limit integer default 20,
  p_before_date date default null,
  p_before_start time default null,
  p_before_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_status text default 'all',
  p_role_ids uuid[] default null,
  p_query text default null,
  p_member_ids uuid[] default null
)
returns setof public.shifts
language sql stable security definer set search_path = '' as $$
  select s.*
    from public.shifts s
   where private.owner_past_shift_matches(
           s, p_venue_ids, p_from, p_to, p_status, p_role_ids, p_query,
           p_member_ids
         )
     and (
       p_before_date is null
       or (s.date, s.start_time, s.id)
          < (p_before_date, p_before_start, p_before_id)
     )
   order by s.date desc, s.start_time desc, s.id desc
   limit least(greatest(coalesce(p_limit, 20), 0), 100);
$$;

create function public.get_owner_past_shifts_count(
  p_venue_ids uuid[],
  p_from date default null,
  p_to date default null,
  p_status text default 'all',
  p_role_ids uuid[] default null,
  p_query text default null,
  p_member_ids uuid[] default null
)
returns bigint language sql stable security definer set search_path = '' as $$
  select count(*)
    from public.shifts s
   where private.owner_past_shift_matches(
           s, p_venue_ids, p_from, p_to, p_status, p_role_ids, p_query,
           p_member_ids
         );
$$;

grant execute on function
  public.get_owner_past_shifts_page(uuid[], integer, date, time, uuid, date, date, text, uuid[], text, uuid[]),
  public.get_owner_past_shifts_count(uuid[], date, date, text, uuid[], text, uuid[])
to authenticated;
