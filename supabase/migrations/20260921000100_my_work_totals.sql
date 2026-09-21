-- Le mie ore su un periodo (settimana o mese), come il titolare legge le sue.
--
-- `get_my_work_history_totals()` conta da sempre e fra tutte le aziende: un
-- numero che cresce all'infinito e non risponde a «quanto ho lavorato questa
-- settimana». Resta per lo Storico; il Profilo usa questa. Il tetto (62 giorni)
-- è lo stesso di `get_staff_planning`.

create function public.get_my_work_totals(p_from date, p_to date)
returns table (total_count integer, total_hours numeric)
language sql stable security definer set search_path = '' as $$
  select count(*)::integer, coalesce(sum(hours), 0)
    from private.my_work_history((select auth.uid()))
   where date >= p_from and date <= least(p_to, p_from + 62);
$$;

grant execute on function public.get_my_work_totals(date, date) to authenticated;

-- Lo storico di un periodo, per intero: lo Storico filtra per settimana o mese e
-- somma in memoria. Stesso tetto di 62 giorni, quindi niente paginazione.
create function public.get_my_work_history_range(p_from date, p_to date)
returns table (
  key text, venue_name text, logo_url text, title text, date date,
  start_time time, end_time time, hours numeric
) language sql stable security definer set search_path = '' as $$
  select * from private.my_work_history((select auth.uid()))
   where date >= p_from and date <= least(p_to, p_from + 62)
   order by date desc, key desc;
$$;

grant execute on function public.get_my_work_history_range(date, date) to authenticated;
