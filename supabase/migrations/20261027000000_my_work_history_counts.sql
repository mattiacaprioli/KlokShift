-- Le ore del dipendente con le regole della sede (revisione E02).
--
-- Lo storico personale contava ogni turno concluso: chi timbra dall'app e non
-- aveva timbrato, o aspettava l'approvazione, vedeva già le ore del turno, con
-- la frase «finché non è approvata valgono le ore del turno». Per la sede quelle
-- ore non contano finché non sono sistemate (`get_workspace_hours_summary`,
-- `get_hours_to_fix`): il dipendente vedeva più ore di quelle che arrivano al
-- consulente, e nessuno gli diceva di chiedere.
--
-- Ogni riga ora dice se conta e, se no, perché:
--   counts          la condizione «conta» di `shifts_count` nel riepilogo;
--   pending_reason  i `kind` di `get_hours_to_fix` (not_clocked, missing_out,
--                   to_approve), null sulle righe che contano;
--   hours           sulle righe che contano le ore di `approved_hours`
--                   (`worked_hours` o `definitive_manual_hours`), sulle altre
--                   quelle che mostra `get_hours_to_fix`.
-- I totali contano solo le ore che contano, e a parte quelle in attesa.
--
-- Per la revisione E09 (correzioni visibili) la riga dice anche se gli orari
-- li ha inseriti la sede (`entered`) o li ha corretti (`corrected`), con
-- l'ultimo motivo scritto.
--
-- ⚠️ Gemello di `get_workspace_hours_summary` (shifts_count, approved_hours) e
-- di `get_hours_to_fix`: se cambia la regola di cosa conta, cambiano insieme.
-- Il test SQL 039 confronta i tre lati.
--
-- Il tipo di ritorno cambia: si ricreano la funzione privata e le quattro
-- letture, con gli stessi grant.

drop function public.get_my_work_history_range(date, date);
drop function public.get_my_work_history_page(integer, date, text);
drop function public.get_my_work_totals(date, date);
drop function public.get_my_work_history_totals();
drop function private.my_work_history(uuid);

create function private.my_work_history(p_user uuid)
returns table (
  key text, venue_name text, logo_url text, title text, date date,
  start_time time, end_time time, hours numeric, shift_id uuid, role_name text,
  planned_hours numeric, worked_hours numeric,
  clock_in_at timestamptz, clock_out_at timestamptz,
  hours_source text, proposed_hours numeric,
  counts boolean, pending_reason text, clock_edit text, clock_edit_reason text
)
language sql stable set search_path = '' as $$
  with rows as (
    select a.id, a.worked_hours, a.hours_source, a.attendance_reviewed_at,
           s.id as shift_id, s.title, s.date, s.start_time, s.end_time,
           s.break_minutes, s.break_paid,
           v.name as venue_name, v.logo_url,
           coalesce(vm.clock_method, v.clock_method) as effective_clock_method,
           vr.name as role_name,
           r.id as clock_record_id, r.method as clock_record_method,
           t.clock_in_at, t.clock_out_at
      from public.shift_assignments a
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.workspace_members m on m.id = vm.member_id
      join public.shifts s on s.id = a.shift_id
      join public.venues v on v.id = s.venue_id
      left join public.venue_roles vr on vr.id = a.role_id
      left join public.shift_clock_records r
        on r.assignment_id = a.id and r.voided_at is null
      left join lateral private.clock_record_times(r.id) t on r.id is not null
     where m.workspace_id in (select private.commercial_readable_workspace_ids())
       and m.user_id = p_user
       and s.status <> 'cancelled'
       and a.status not in ('declined', 'no_show')
       and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
  ), classified as (
    -- La condizione «conta» di `shifts_count`; `is true` perché con
    -- `hours_source` nullo vale NULL, che il riepilogo legge come «non conta».
    select x.*,
           ((x.worked_hours is not null and
              (x.hours_source = 'manual' or (x.clock_record_id is not null
                and x.attendance_reviewed_at is not null and x.clock_out_at is not null)))
            or (x.worked_hours is null and x.clock_record_id is null and
              (x.hours_source = 'manual_auto' or
                (x.hours_source is null and x.effective_clock_method = 'manual')))
           ) is true as counts
      from rows x
  )
  select 'asg-' || c.id::text, c.venue_name, c.logo_url, c.title, c.date,
         c.start_time, c.end_time,
         case
           when c.counts and c.worked_hours is not null then c.worked_hours
           when c.counts then private.definitive_manual_hours(c.id, null)
           when c.clock_record_id is not null and c.clock_out_at is not null
             then private.clock_record_counted_hours(c.clock_record_id)
           else public.shift_counted_hours(c.start_time, c.end_time, c.break_minutes, c.break_paid)
         end,
         c.shift_id, c.role_name,
         public.shift_counted_hours(c.start_time, c.end_time, c.break_minutes, c.break_paid),
         c.worked_hours,
         c.clock_in_at, c.clock_out_at,
         case
           when c.worked_hours is not null and c.attendance_reviewed_at is not null then 'approved'
           when c.worked_hours is not null then 'adjusted'
           when c.clock_record_id is not null then 'pending'
           else 'planned'
         end,
         case when c.clock_record_id is not null and c.clock_out_at is not null
              then private.clock_record_counted_hours(c.clock_record_id) end,
         c.counts,
         case
           when c.counts then null
           when c.clock_record_id is not null and c.clock_out_at is null then 'missing_out'
           when c.clock_record_id is not null then 'to_approve'
           else 'not_clocked'
         end,
         case
           when c.clock_record_id is null then null
           when c.clock_record_method = 'manual' then 'entered'
           when exists (select 1 from public.shift_clock_corrections k
                         where k.clock_record_id = c.clock_record_id) then 'corrected'
         end,
         (select k.reason from public.shift_clock_corrections k
           where c.clock_record_id is not null and k.clock_record_id = c.clock_record_id
             and k.reason is not null
           order by k.created_at desc, k.id desc limit 1)
    from classified c;
$$;

create function public.get_my_work_history_range(p_from date, p_to date)
returns table (
  key text, venue_name text, logo_url text, title text, date date,
  start_time time, end_time time, hours numeric, shift_id uuid, role_name text,
  planned_hours numeric, worked_hours numeric,
  clock_in_at timestamptz, clock_out_at timestamptz,
  hours_source text, proposed_hours numeric,
  counts boolean, pending_reason text, clock_edit text, clock_edit_reason text
)
language sql stable security definer set search_path = '' as $$
  select h.* from private.my_work_history((select auth.uid())) h
   where h.date >= p_from and h.date <= least(p_to, p_from + 62)
   order by h.date desc, h.key desc;
$$;

create function public.get_my_work_history_page(
  p_limit integer default 20,
  p_before_date date default null,
  p_before_key text default null
)
returns table (
  key text, venue_name text, logo_url text, title text, date date,
  start_time time, end_time time, hours numeric, shift_id uuid, role_name text,
  planned_hours numeric, worked_hours numeric,
  clock_in_at timestamptz, clock_out_at timestamptz,
  hours_source text, proposed_hours numeric,
  counts boolean, pending_reason text, clock_edit text, clock_edit_reason text
)
language sql stable security definer set search_path = '' as $$
  select h.* from private.my_work_history((select auth.uid())) h
   where p_before_date is null
      or (h.date, h.key) < (p_before_date, p_before_key)
   order by h.date desc, h.key desc
   limit greatest(p_limit, 0);
$$;

-- Turni svolti tutti; ore solo quelle che contano, le altre a parte.
create function public.get_my_work_totals(p_from date, p_to date)
returns table (total_count integer, total_hours numeric, pending_count integer, pending_hours numeric)
language sql stable security definer set search_path = '' as $$
  select count(*)::integer,
         coalesce(sum(hours) filter (where counts), 0),
         (count(*) filter (where not counts))::integer,
         coalesce(sum(hours) filter (where not counts), 0)
    from private.my_work_history((select auth.uid()))
   where date >= p_from and date <= least(p_to, p_from + 62);
$$;

create function public.get_my_work_history_totals()
returns table (total_count integer, total_hours numeric, pending_count integer, pending_hours numeric)
language sql stable security definer set search_path = '' as $$
  select count(*)::integer,
         coalesce(sum(hours) filter (where counts), 0),
         (count(*) filter (where not counts))::integer,
         coalesce(sum(hours) filter (where not counts), 0)
    from private.my_work_history((select auth.uid()));
$$;

revoke all on function private.my_work_history(uuid) from public, anon, authenticated;
grant execute on function
  public.get_my_work_history_range(date, date),
  public.get_my_work_history_page(integer, date, text),
  public.get_my_work_totals(date, date),
  public.get_my_work_history_totals()
to authenticated;
