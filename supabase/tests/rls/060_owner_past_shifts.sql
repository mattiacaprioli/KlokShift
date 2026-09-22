-- Storico del gestore: confine temporale reale, filtri e cursore keyset.
begin;

-- Una clock fissa rende riproducibili i casi «oggi» e il notturno ancora in
-- corso. Il rollback ripristina la funzione della baseline.
create or replace function public.local_now()
returns timestamp language sql stable set search_path = '' as $$
  select timestamp '2026-09-23 16:00:00';
$$;

do $$
declare
  v1 uuid := tests.id('V1');
  v2 uuid := tests.id('V2');
  v3 uuid := tests.id('V3');
  role_id uuid := gen_random_uuid();
  special_id uuid;
  cursor_date date;
  cursor_start time;
  cursor_id uuid;
  page1 uuid[];
  page2 uuid[];
begin
  perform tests.logout();

  insert into public.venue_roles (id, venue_id, name)
  values (role_id, v1, 'Barman');

  -- Più di una pagina, tutti con data e ora uguali: soltanto `id` distingue la
  -- posizione nel cursore. Uno porta anche ruolo e titolo cercabili.
  insert into public.shifts (
    id, venue_id, title, date, start_time, end_time, status
  )
  select gen_random_uuid(), v1,
         case when n = 1 then 'Speciale barman' else 'Duplicato ' || n end,
         date '2026-09-20', time '09:00', time '13:00', 'open'
    from generate_series(1, 23) n;

  select id into special_id
    from public.shifts where title = 'Speciale barman';
  insert into public.shift_role_requirements (shift_id, venue_id, role_id)
  values (special_id, v1, role_id);

  insert into public.shifts (venue_id, title, date, start_time, end_time, status)
  values
    (v1, 'Oggi concluso', '2026-09-23', '09:00', '13:00', 'open'),
    (v1, 'Oggi futuro', '2026-09-23', '18:00', '23:00', 'open'),
    (v1, 'Notte ancora in corso', '2026-09-22', '22:00', '17:00', 'open'),
    (v1, 'Oggi annullato', '2026-09-23', '08:00', '12:00', 'cancelled'),
    (v2, 'Altra sede autorizzata', '2026-09-20', '09:00', '13:00', 'open'),
    (v3, 'Altra azienda', '2026-09-20', '09:00', '13:00', 'open');

  perform tests.login('Ow');

  perform tests.eq(
    public.get_owner_past_shifts_count(array[v1]), 25::bigint,
    'conteggio: duplicati + oggi conclusi, non turni ancora in corso');
  perform tests.ok(
    exists (
      select 1 from public.get_owner_past_shifts_page(array[v1], 100) p
       where p.title = 'Oggi concluso'
    ),
    'un turno terminato oggi entra subito nello storico');
  perform tests.ok(
    not exists (
      select 1 from public.get_owner_past_shifts_page(array[v1], 100) p
       where p.title in ('Oggi futuro', 'Notte ancora in corso')
    ),
    'oggi futuro e ieri notte ancora in corso restano fuori');

  perform tests.eq(
    public.get_owner_past_shifts_count(array[v1], p_status => 'done'),
    24::bigint, 'filtro conclusi esclude annullati');
  perform tests.eq(
    public.get_owner_past_shifts_count(array[v1], p_status => 'cancelled'),
    1::bigint, 'filtro annullati conserva il caso scelto');
  perform tests.eq(
    public.get_owner_past_shifts_count(array[v1], p_role_ids => array[role_id]),
    1::bigint, 'filtro mansione');
  perform tests.eq(
    public.get_owner_past_shifts_count(array[v1], p_query => 'barman'),
    1::bigint, 'filtro testo');
  perform tests.eq(
    public.get_owner_past_shifts_count(
      array[v1], p_from => '2026-09-23', p_to => '2026-09-23'
    ),
    2::bigint, 'periodo include soltanto i turni di oggi già terminati');
  perform tests.eq(
    public.get_owner_past_shifts_count(array[v1, v2, v3]),
    26::bigint, 'scope include un altra sede gestita ma non un altra azienda');

  select array_agg(p.id) into page1
    from public.get_owner_past_shifts_page(array[v1], 20) p;
  select p.date, p.start_time, p.id
    into cursor_date, cursor_start, cursor_id
    from public.get_owner_past_shifts_page(array[v1], 20) p
   offset 19 limit 1;
  select array_agg(p.id) into page2
    from public.get_owner_past_shifts_page(
      array[v1], 20, cursor_date, cursor_start, cursor_id
    ) p;

  perform tests.eq(cardinality(page1), 20, 'prima pagina piena');
  perform tests.eq(cardinality(page2), 5, 'seconda pagina completa');
  perform tests.eq(
    (select count(distinct id) from unnest(page1 || page2) id),
    25::bigint, 'nessuna perdita o duplicazione con data e ora uguali');
end $$;

rollback;
select 'owner past shifts: ok' as result;
