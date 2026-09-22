-- Storico turni del gestore con lo stesso confine temporale dei report e del
-- client: un turno entra appena il suo istante di fine è passato, non alla
-- mezzanotte successiva. API additive: le SELECT dirette restano disponibili
-- ai client già pubblicati.

-- Un solo predicato per pagina e conteggio. Tenerlo in private impedisce che
-- le due RPC divergano di nuovo su tempo, sedi o filtri.
create function private.owner_past_shift_matches(
  p_shift public.shifts,
  p_venue_ids uuid[],
  p_from date,
  p_to date,
  p_status text,
  p_role_ids uuid[],
  p_query text
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
  p_query text default null
)
returns setof public.shifts
language sql stable security definer set search_path = '' as $$
  select s.*
    from public.shifts s
   where private.owner_past_shift_matches(
           s, p_venue_ids, p_from, p_to, p_status, p_role_ids, p_query
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
  p_query text default null
)
returns bigint language sql stable security definer set search_path = '' as $$
  select count(*)
    from public.shifts s
   where private.owner_past_shift_matches(
           s, p_venue_ids, p_from, p_to, p_status, p_role_ids, p_query
         );
$$;

grant execute on function
  public.get_owner_past_shifts_page(uuid[], integer, date, time, uuid, date, date, text, uuid[], text),
  public.get_owner_past_shifts_count(uuid[], date, date, text, uuid[], text)
to authenticated;
