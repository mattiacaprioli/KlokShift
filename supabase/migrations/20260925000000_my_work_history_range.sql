-- Lo storico di un periodo, per intero: lo Storico del professionista («Le mie
-- ore») filtra per settimana o mese e somma in memoria. Stesso tetto di 62
-- giorni di `get_my_work_totals`, quindi niente paginazione.
--
-- ⚠️ Era stata aggiunta in coda a `20260921000100_my_work_totals.sql` dopo che
-- quella migration era già stata applicata: il remoto l'aveva registrata come
-- eseguita e la funzione non è mai nata, e «Le mie ore» andava in errore su
-- Settimana e Mese. Una migration applicata non si modifica: se ne scrive una
-- nuova. `or replace` perché i database locali costruiti dopo quel commit la
-- hanno già.
create or replace function public.get_my_work_history_range(p_from date, p_to date)
returns table (
  key text, venue_name text, logo_url text, title text, date date,
  start_time time, end_time time, hours numeric
) language sql stable security definer set search_path = '' as $$
  select * from private.my_work_history((select auth.uid()))
   where date >= p_from and date <= least(p_to, p_from + 62)
   order by date desc, key desc;
$$;

grant execute on function public.get_my_work_history_range(date, date) to authenticated;
