-- Ferie, permessi e malattia nel planning (FERIE_MALATTIA.md, fase F2).
--
-- Chi prepara i turni deve sapere chi **non** può lavorare, ma non perché.
-- `staff_absences` la legge solo chi ha il permesso Organico ('staff'), perché
-- il tipo 'malattia' è un dato sanitario (GDPR art. 9). Un delegato con i soli
-- turni non ha quel permesso. Questa funzione gli dà le date e mai il tipo: nel
-- planning vede «non disponibile», non «malattia».
--
-- Anche il titolare e chi ha 'staff' passano da qui per il planning: una fonte
-- sola, così le due viste non possono raccontare due cose diverse.
--
-- Solo 'pending' e 'approved'. Una richiesta in sospeso compare (più leggera)
-- perché è proprio mentre si decide che conviene non metterci sopra dei turni.
create or replace function public.get_absence_availability(p_from date, p_to date)
returns table (
  id uuid,
  person_id uuid,
  start_date date,
  end_date date,
  start_time time,
  end_time time,
  status public.absence_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.person_id, a.start_date, a.end_date, a.start_time, a.end_time, a.status
    from public.staff_absences a
   where a.status in ('pending', 'approved')
     and a.start_date <= p_to
     and a.end_date   >= p_from
     and (
       a.owner_id = (select auth.uid())
       or exists (
         select 1 from public.staff_members sm
          where sm.person_id = a.person_id
            and sm.link_status <> 'left'
            and sm.venue_id in (select public.my_venue_ids('roster'))
       )
     )
   order by a.start_date;
$$;

revoke execute on function public.get_absence_availability(date, date) from anon, public;
grant execute on function public.get_absence_availability(date, date) to authenticated;

comment on function public.get_absence_availability(date, date) is
  'Le assenze attive (in sospeso o approvate) delle persone che l''utente può mettere in turno, senza il tipo: è la fonte del planning.';
