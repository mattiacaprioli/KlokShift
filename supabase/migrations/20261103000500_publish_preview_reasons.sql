-- Bozza e pubblicazione: perché l'anteprima non avvisa nessuno.
--
-- `people` conta chi riceverà la notifica, tolto chi pubblica (private.notify
-- salta chi agisce). Quando è zero la finestra diceva sempre «i turni sono
-- senza persone o senza account», anche quando nel turno c'era solo il titolare
-- stesso. Due chiavi in più, così il motivo si dice giusto:
--
--   * `assignees`: persone (distinte) in attesa o confermate nei turni che si
--     pubblicano, con o senza account, chi pubblica compreso;
--   * `self`: chi pubblica è fra loro.
--
-- Solo chiavi aggiunte al jsonb: le app già installate le ignorano.

create or replace function public.get_publish_preview(p_venues uuid[], p_from date, p_to date)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  with scope as (
    select v.id
      from public.venues v
     where (p_venues is null or v.id = any (p_venues))
       and v.id in (select private.venues_where('shifts'))
       and v.workspace_id in (select private.commercial_readable_workspace_ids())
  ), drafts as (
    select s.id, s.date, s.start_time,
           public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now() as finished
      from public.shifts s
     where s.venue_id in (select id from scope)
       and s.published_at is null
       and s.status <> 'cancelled'
  ), target as (
    select d.id, d.date, d.start_time from drafts d
     where not d.finished and d.date between p_from and p_to
  ), crew as (
    select distinct m.id as member_id, m.user_id
      from public.shift_assignments a
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.workspace_members m on m.id = vm.member_id
     where a.shift_id in (select id from target)
       and a.status in ('assigned', 'confirmed')
  )
  select jsonb_build_object(
    'shift_ids', coalesce((select jsonb_agg(t.id order by t.date, t.start_time, t.id) from target t), '[]'::jsonb),
    'shifts', (select count(*) from target)::integer,
    'people', (select count(distinct c.user_id) from crew c
                where c.user_id is not null
                  and c.user_id is distinct from (select auth.uid()))::integer,
    'assignees', (select count(*) from crew)::integer,
    'self', exists (select 1 from crew c where c.user_id = (select auth.uid())),
    'outside', (select count(*) from drafts d
                 where not d.finished and (d.date < p_from or d.date > p_to))::integer,
    'expired', (select count(*) from drafts d where d.finished)::integer
  );
$function$;
