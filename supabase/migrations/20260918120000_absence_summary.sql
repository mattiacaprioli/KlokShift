-- Riepilogo delle assenze per il commercialista (FERIE_MALATTIA.md, fase F3).
--
-- Una riga per persona sul periodo [p_from, p_to), con p_to **escluso**, come
-- `get_owner_hours_summary`: la pagina Ore passa lo stesso intervallo alle due.
--
-- Solo le assenze 'approved'. Una richiesta in sospeso non è un'assenza, e una
-- rifiutata o ritirata non è mai successa.
--
-- Giorni = giorni di **calendario** dell'intervallo, tagliati sul periodo. Non
-- giorni lavorativi: quelli dipendono dal contratto e dal calendario delle
-- festività, e il conteggio lo fa il consulente del lavoro. L'export lo scrive.
--
-- Il permesso ha due misure: i giorni dei permessi a giornata intera e le ore di
-- quelli a ore. Sommarli in un numero solo vorrebbe dire inventare quante ore
-- vale una giornata.
--
-- DEFINER perché il perimetro è il permesso Ore, non Organico: chi prepara le
-- buste paga deve contare le malattie anche senza poter aprire le schede delle
-- persone. Le righe restano limitate alle persone con un'appartenenza, anche
-- passata, in una sede con 'hours': chi è uscito a metà mese va comunque pagato.
create or replace function public.get_owner_absence_summary(p_from date, p_to date)
returns table (
  person_id      uuid,
  person_name    text,
  ferie_days     integer,
  permesso_days  integer,
  permesso_hours numeric,
  malattia_days  integer,
  inps_protocols text
)
language sql
stable
security definer
set search_path = ''
as $$
  with clipped as (
    select
      a.person_id,
      a.kind,
      a.start_time,
      a.end_time,
      a.inps_protocol,
      (least(a.end_date, p_to - 1) - greatest(a.start_date, p_from) + 1) as days
    from public.staff_absences a
    where a.status = 'approved'
      and a.start_date < p_to
      and a.end_date  >= p_from
      and exists (
        select 1 from public.staff_members sm
         where sm.person_id = a.person_id
           and sm.venue_id in (select public.my_venue_ids('hours'))
      )
  )
  select
    p.id,
    p.full_name,
    coalesce(sum(c.days) filter (where c.kind = 'ferie'), 0)::int,
    coalesce(sum(c.days) filter (where c.kind = 'permesso' and c.start_time is null), 0)::int,
    round(coalesce(sum(extract(epoch from (c.end_time - c.start_time)) / 3600)
             filter (where c.kind = 'permesso' and c.start_time is not null), 0), 2),
    coalesce(sum(c.days) filter (where c.kind = 'malattia'), 0)::int,
    string_agg(c.inps_protocol, ', ' order by c.inps_protocol)
      filter (where c.kind = 'malattia' and c.inps_protocol is not null)
  from clipped c
  join public.staff_people p on p.id = c.person_id
  group by p.id, p.full_name
  order by p.full_name;
$$;

revoke execute on function public.get_owner_absence_summary(date, date) from anon, public;
grant execute on function public.get_owner_absence_summary(date, date) to authenticated;

comment on function public.get_owner_absence_summary(date, date) is
  'Giorni di ferie, giorni e ore di permesso, giorni di malattia (con i protocolli INPS) per persona nel periodo [p_from, p_to), solo assenze approvate. Perimetro: permesso Ore.';
