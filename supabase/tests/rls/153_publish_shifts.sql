-- Turni in bozza (parte 3): anteprima, pubblicazione, «Conferma tutti» e
-- «Registra come fatto». Date future relative a oggi, una scaduta nel passato.
begin;

do $$
declare
  vm uuid;      -- Emma in V1 (fissa)
  vm_v2 uuid;   -- Emma anche in V2, per il luogo «W1»
  vm2 uuid;     -- Enzo in V2
  d date := current_date + 2;
  past date := current_date - 3;
  emma uuid[];  -- tre bozze di Emma in V1, nella settimana
  enzo uuid;    -- una bozza di Enzo in V2, nella settimana
  fuori uuid;   -- bozza di V1 fuori periodo
  scad uuid;    -- bozza di V1 scaduta, con Emma
  vuota uuid;   -- bozza scaduta senza persone
  pubb uuid;    -- turno pubblicato finito
  co_v1 uuid;
  co_v2 uuid;
  ids uuid[];
  r jsonb;
  n_emp integer;
  n_emp2 integer;
  n_all integer;
  a_enzo uuid;
  a_bozza uuid;
  a_emma uuid[];
  first_s public.shifts;
begin
  select x.id into vm from public.venue_members x
   where x.member_id = tests.id('M_Emp') and x.venue_id = tests.id('V1');
  select x.id into vm2 from public.venue_members x
   where x.member_id = tests.id('M_Emp2') and x.venue_id = tests.id('V2');

  perform tests.login('Ow');
  emma := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Sera', 'draft', true, 'require_confirmation', true,
    'dates', jsonb_build_array(d::text, (d + 1)::text, (d + 3)::text),
    'start_time', '18:00', 'end_time', '23:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm)))));
  ids := public.create_shifts(jsonb_build_array(
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Mattina', 'draft', true,
      'dates', jsonb_build_array((d + 2)::text), 'start_time', '10:00', 'end_time', '12:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2))),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Fuori periodo', 'draft', true,
      'dates', jsonb_build_array((d + 10)::text), 'start_time', '10:00', 'end_time', '12:00')));
  enzo := ids[1]; fuori := ids[2];
  ids := tests.create_shifts(jsonb_build_array(
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Scaduta', 'date', past::text,
      'start_time', '12:00', 'end_time', '15:00', 'draft', true,
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm)))));
  scad := ids[1];
  perform tests.logout();
  perform tests.eq((select count(*)::integer from public.shift_assignments
                     where shift_id = any (emma) and status = 'assigned'), 3,
    'con «chiedi conferma» anche la fissa è in attesa');

  -- ---------------------------------------------------------------------------
  -- Anteprima.
  -- ---------------------------------------------------------------------------
  perform tests.login('Ow');
  r := public.get_publish_preview(array[tests.id('V1'), tests.id('V2')], d, d + 6);
  perform tests.eq((r ->> 'shifts')::integer, 4, 'anteprima: quattro bozze nel periodo');
  perform tests.eq((r ->> 'people')::integer, 2, 'due persone avvisate (chi pubblica esclusa)');
  perform tests.eq((r ->> 'outside')::integer, 1, 'una bozza fuori periodo');
  perform tests.eq((r ->> 'expired')::integer, 1, 'una bozza scaduta');
  perform tests.ok(
    (select array_agg(x::uuid order by x) from jsonb_array_elements_text(r -> 'shift_ids') x)
      = (select array_agg(x order by x) from unnest(emma || enzo) x),
    'gli id sono esattamente le quattro bozze');

  -- ---------------------------------------------------------------------------
  -- Pubblicazione con avvisi: una notifica per persona.
  -- ---------------------------------------------------------------------------
  ids := array(select x::uuid from jsonb_array_elements_text(r -> 'shift_ids') x);
  perform tests.logout();
  n_emp := (select count(*)::integer from public.notifications where user_id = tests.id('Emp'));
  n_emp2 := (select count(*)::integer from public.notifications where user_id = tests.id('Emp2'));
  perform tests.login('Ow');
  r := public.publish_shifts(ids, true);
  perform tests.eq((r ->> 'published')::integer, 4, 'quattro turni pubblicati');
  perform tests.eq((r ->> 'notified')::integer, 2, 'due persone avvisate');
  perform tests.ok((select bool_and(published_at is not null and published_by = tests.id('Ow'))
                      from public.shifts where id = any (ids)),
    'pubblicati da chi ha premuto');
  perform tests.ok((select published_at is null from public.shifts where id = fuori),
    'la bozza fuori periodo resta bozza');
  perform tests.logout();

  perform tests.eq((select count(*)::integer from public.notifications where user_id = tests.id('Emp')), n_emp + 1,
    'Emma riceve una notifica sola');
  perform tests.eq((select count(*)::integer from public.notifications where user_id = tests.id('Emp2')), n_emp2 + 1,
    'Enzo riceve una notifica sola');
  perform tests.eq((select title || ' | ' || body from public.notifications
                     where user_id = tests.id('Emp') and type = 'shift_published'),
    'Nuovi turni | V1: 3 nuovi turni per te, dal ' || to_char(d, 'DD/MM') || ' al '
      || to_char(d + 3, 'DD/MM') || '. Conferma la presenza.',
    'il testo per Emma');
  perform tests.eq((select related_id from public.notifications
                     where user_id = tests.id('Emp') and type = 'shift_published'),
    (select id from public.shifts where id = any (emma) order by date, start_time limit 1),
    'la notifica apre il primo dei suoi turni');
  perform tests.eq((select title || ' | ' || body from public.notifications
                     where user_id = tests.id('Emp2') and type = 'shift_published'),
    'Nuovo turno | V2: un nuovo turno per te, il ' || to_char(d + 2, 'DD/MM')
      || ' dalle 10:00 alle 12:00. Conferma la presenza.',
    'il testo per Enzo');
  perform tests.eq((select public.notification_category(type) from public.notifications
                     where user_id = tests.id('Emp2') and type = 'shift_published'), 'shifts',
    'categoria Turni');

  -- Emma ora vede i suoi turni.
  perform tests.login('Emp');
  perform tests.eq((select count(*)::integer from public.shifts where id = any (emma)), 3, 'Emma vede i turni');
  perform tests.logout();

  -- Doppio tocco: niente di nuovo.
  perform tests.login('Ow');
  r := public.publish_shifts(ids, true);
  perform tests.eq((r ->> 'published')::integer, 0, 'seconda pubblicazione: nessun turno');
  perform tests.eq((r ->> 'notified')::integer, 0, 'nessun avviso');
  perform tests.logout();
  perform tests.eq((select count(*)::integer from public.notifications
                     where user_id in (tests.id('Emp'), tests.id('Emp2'))), n_emp + n_emp2 + 2,
    'nessuna notifica nuova');

  -- Dopo la pubblicazione una modifica vale e avvisa subito, come prima.
  select * into first_s from public.shifts where id = emma[1];
  perform tests.login('Ow');
  perform public.update_shift(first_s.id, jsonb_build_object('title', first_s.title, 'date', first_s.date::text,
    'start_time', '17:00', 'end_time', '23:00', 'require_confirmation', true));
  perform tests.logout();
  perform tests.eq((select count(*)::integer from public.notifications
                     where user_id = tests.id('Emp') and type = 'shift_updated' and related_id = first_s.id), 1,
    'una modifica dopo la pubblicazione avvisa Emma');

  -- ---------------------------------------------------------------------------
  -- Il luogo: turni di Emma in due sedi pubblicati insieme → l'azienda.
  -- ---------------------------------------------------------------------------
  insert into public.venue_members (member_id, venue_id, workspace_id, employment_type)
  values (tests.id('M_Emp'), tests.id('V2'), tests.id('W1'), 'fisso') returning id into vm_v2;
  perform tests.login('Ow');
  ids := public.create_shifts(jsonb_build_array(
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Due sedi', 'draft', true,
      'dates', jsonb_build_array((d + 4)::text), 'start_time', '09:00', 'end_time', '13:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Due sedi', 'draft', true,
      'dates', jsonb_build_array((d + 5)::text), 'start_time', '09:00', 'end_time', '13:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm_v2)))));
  r := public.publish_shifts(ids, true);
  perform tests.eq((r ->> 'notified')::integer, 1, 'una persona, due sedi');
  perform tests.logout();
  perform tests.eq((select title || ' | ' || body from public.notifications
                     where user_id = tests.id('Emp') and type = 'shift_published'
                       and related_id = ids[1]),
    'Nuovi turni | W1: 2 nuovi turni per te, dal ' || to_char(d + 4, 'DD/MM') || ' al '
      || to_char(d + 5, 'DD/MM') || '.',
    'più sedi: il nome dell''azienda; tutto confermato: niente richiesta di conferma');

  -- ---------------------------------------------------------------------------
  -- Senza avvisi: si vede, ma non parte niente.
  -- ---------------------------------------------------------------------------
  n_all := (select count(*)::integer from public.notifications);
  perform tests.login('Ow');
  ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'In silenzio', 'draft', true,
    'dates', jsonb_build_array((d + 6)::text), 'start_time', '09:00', 'end_time', '13:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm)))));
  r := public.publish_shifts(ids, false);
  perform tests.eq((r ->> 'published')::integer, 1, 'pubblicato senza avvisi');
  perform tests.eq((r ->> 'notified')::integer, 0, 'nessuno avvisato');
  perform tests.logout();
  perform tests.eq((select count(*)::integer from public.notifications), n_all, 'zero notifiche');
  perform tests.login('Emp');
  perform tests.eq((select count(*)::integer from public.shifts where id = ids[1]), 1,
    'ma Emma vede il turno');
  perform tests.logout();

  -- ---------------------------------------------------------------------------
  -- Permessi: Co ha «Turni» solo su V1.
  -- ---------------------------------------------------------------------------
  perform tests.login('Ow');
  ids := public.create_shifts(jsonb_build_array(
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Bozza Co', 'draft', true,
      'dates', jsonb_build_array((d + 1)::text), 'start_time', '07:00', 'end_time', '09:00'),
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Bozza Co', 'draft', true,
      'dates', jsonb_build_array((d + 1)::text), 'start_time', '07:00', 'end_time', '09:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2)))));
  co_v1 := ids[1]; co_v2 := ids[2];
  perform tests.logout();
  perform tests.login('Co');
  r := public.get_publish_preview(array[tests.id('V1'), tests.id('V2')], d, d + 6);
  perform tests.ok(r -> 'shift_ids' @> to_jsonb(array[co_v1]), 'Co vede la bozza di V1 nell''anteprima');
  perform tests.ok(not (r -> 'shift_ids' @> to_jsonb(array[co_v2])), 'ma non quella di V2');
  perform tests.eq((r ->> 'shifts')::integer, 1, 'una sola bozza per Co');
  perform tests.eq((r ->> 'expired')::integer, 1, 'le scadute solo di V1');
  perform tests.raises(format('select public.publish_shifts(array[%L]::uuid[], true)', co_v2), 'not_allowed',
    'Co non pubblica V2');
  perform tests.raises(format('select public.publish_shifts(array[%L, %L]::uuid[], true)', co_v1, co_v2),
    'not_allowed', 'né insieme a V1');
  perform tests.logout();
  perform tests.ok((select bool_and(published_at is null) from public.shifts where id in (co_v1, co_v2)),
    'niente cambia: restano bozze');

  -- Un dipendente non pubblica.
  perform tests.login('Emp');
  perform tests.raises(format('select public.publish_shifts(array[%L]::uuid[], true)', co_v1), 'not_allowed',
    'Emma non pubblica');
  perform tests.logout();

  -- ---------------------------------------------------------------------------
  -- Conferma tutti.
  -- ---------------------------------------------------------------------------
  a_emma := array(select a.id from public.shift_assignments a where a.shift_id = any (emma));
  select a.id into a_enzo from public.shift_assignments a where a.shift_id = enzo;
  select a.id into a_bozza from public.shift_assignments a where a.shift_id = co_v2;
  perform tests.login('Emp');
  perform tests.eq(public.confirm_my_assignments(a_emma || a_enzo || a_bozza), 3,
    'conferma le sue tre, pubblicate e in attesa');
  perform tests.eq(public.confirm_my_assignments(a_emma || a_enzo), 0, 'una seconda volta: niente');
  perform tests.logout();
  perform tests.ok((select bool_and(status = 'confirmed' and confirmed_at is not null)
                      from public.shift_assignments where id = any (a_emma)),
    'le tre di Emma sono confermate');
  perform tests.eq((select status::text from public.shift_assignments where id = a_enzo), 'assigned',
    'quella di Enzo è intatta');
  perform tests.eq((select status::text from public.shift_assignments where id = a_bozza), 'assigned',
    'e una bozza non si conferma');
  perform tests.login('Emp2');
  perform tests.eq(public.confirm_my_assignments(array[a_bozza]), 0,
    'nemmeno da chi c''è assegnato: non la vede');
  perform tests.logout();

  -- ---------------------------------------------------------------------------
  -- Registra come fatto.
  -- ---------------------------------------------------------------------------
  perform tests.login('Ow');
  ids := tests.create_shifts(jsonb_build_array(
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Vuota', 'date', past::text,
      'start_time', '08:00', 'end_time', '10:00', 'draft', true),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Fatto', 'date', (past - 1)::text,
      'start_time', '08:00', 'end_time', '10:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm)))));
  vuota := ids[1]; pubb := ids[2];
  perform tests.logout();

  perform tests.login('Co');
  perform tests.raises(format('select public.record_draft_as_done(%L)', scad), 'not_allowed',
    'Turni non basta: serve Ore');
  perform tests.logout();

  n_all := (select count(*)::integer from public.notifications);
  perform tests.login('Co2');
  perform tests.raises(format('select public.record_draft_as_done(%L)', pubb), 'shift_not_draft',
    'un turno pubblicato non è una bozza');
  perform tests.raises(format('select public.record_draft_as_done(%L)', fuori), 'shift_not_finished',
    'una bozza futura non è ancora fatta');
  perform tests.raises(format('select public.record_draft_as_done(%L)', vuota), 'staff_required',
    'senza persone non c''è niente da registrare');
  perform public.record_draft_as_done(scad);
  perform tests.eq((select s.approved_hours from public.get_workspace_hours_summary(tests.id('W1'), past, past + 1) s
                     where s.member_id = tests.id('M_Emp') and s.venue_id = tests.id('V1')), 3::numeric,
    'le ore contano nel riepilogo');
  perform tests.raises(format('select public.record_draft_as_done(%L)', scad), 'shift_not_draft',
    'una seconda volta no');
  perform tests.logout();
  -- Chi ha solo «Ore» legge i turni dalle RPC, non dalla tabella: lo stato si
  -- controlla da fuori.
  perform tests.ok((select published_at is not null and published_by = tests.id('Co2')
                       and recorded_at is not null and recorded_by = tests.id('Co2')
                      from public.shifts where id = scad),
    'registrata: pubblicata e «inserita a mano»');
  perform tests.ok((select bool_and(status = 'confirmed' and confirmed_at is not null
                                    and hours_source = 'manual_auto')
                      from public.shift_assignments where shift_id = scad),
    'le persone risultano presenti con le ore del turno');
  perform tests.eq((select count(*)::integer from public.notifications), n_all,
    'nessuna notifica, di nessun tipo');
end $$;

-- Timbratura senza turno e bozza: la bozza non blocca e non si rivela;
-- registrata poi come fatta, le ore sovrapposte non si contano due volte.
do $$
declare
  vm2 uuid;
  bozza uuid;
  ids uuid[];
  rec public.shift_clock_records;
  started timestamp;
  uplanned uuid;
  bozza2 uuid;
  r record;
begin
  select x.id into vm2 from public.venue_members x
   where x.member_id = tests.id('M_Emp2') and x.venue_id = tests.id('V2');
  perform tests.login('Ow');
  perform public.set_venue_clock_method(tests.id('V2'), 'app');
  perform tests.logout();
  perform tests.login('Co2');
  perform public.set_member_clock_unplanned(vm2, true);
  perform tests.logout();

  -- Una bozza in corso, per Enzo.
  perform tests.login('Ow');
  ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V2'), 'title', 'Bozza in corso', 'draft', true,
    'date', (public.local_now() - interval '10 minutes')::date::text,
    'start_time', to_char(public.local_now() - interval '10 minutes', 'HH24:MI'),
    'end_time', to_char(public.local_now() + interval '50 minutes', 'HH24:MI'),
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2)))));
  bozza := ids[1];
  perform tests.logout();

  perform tests.login('Emp2');
  rec := public.clock_punch_unplanned(vm2, 'in');
  perform tests.ok(rec.id is not null and rec.shift_id is null and rec.assignment_id is null,
    'la bozza non blocca l''entrata fuori turno');
  perform tests.eq((select count(*)::integer from public.shifts where id = bozza), 0,
    'e non si rivela');
  perform tests.logout();

  -- Si porta tutto nel passato (in transazione now() è fermo): fuori turno di
  -- tre ore, la bozza nell'ora centrale.
  started := date_trunc('minute', public.local_now()) - interval '3 hours';
  update public.shift_clock_records set clock_in_at = started at time zone 'Europe/Rome' where id = rec.id;
  update public.shifts set date = (started + interval '1 hour')::date,
         start_time = (started + interval '1 hour')::time,
         end_time = (started + interval '2 hours')::time
   where id = bozza;

  perform tests.login('Emp2');
  rec := public.clock_punch_unplanned(vm2, 'out');
  uplanned := rec.assignment_id;
  perform tests.logout();

  -- Una seconda bozza dentro il fuori turno, registrata con la persona in
  -- «Manuale»: il motivo non dipende dal metodo della sede.
  perform tests.login('Ow');
  ids := tests.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V2'), 'title', 'Bozza manuale', 'draft', true,
    'date', started::date::text, 'start_time', to_char(started, 'HH24:MI'),
    'end_time', to_char(started + interval '30 minutes', 'HH24:MI'),
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2)))));
  bozza2 := ids[1];
  perform tests.logout();

  perform tests.login('Co2');
  perform public.record_draft_as_done(bozza);
  perform tests.logout();
  perform tests.login('Ow');
  perform public.set_member_clock_method(vm2, 'manual');
  perform tests.logout();
  perform tests.login('Co2');
  perform public.record_draft_as_done(bozza2);
  perform public.approve_clock_record(uplanned);
  select coalesce(sum(s.approved_hours), 0) as approved, coalesce(sum(s.shifts_count), 0) as n into r
    from public.get_workspace_hours_summary(tests.id('W1'), started::date - 1, started::date + 2) s
   where s.member_id = tests.id('M_Emp2');
  perform tests.eq(r.approved, 3::numeric,
    'l''ora della bozza dentro il fuori turno non si conta due volte');
  perform tests.eq(r.n, 1::bigint, 'conta solo il fuori turno');
  perform tests.eq((select string_agg(h.kind, ',' order by h.start_time)
                      from public.get_hours_to_fix(tests.id('W1'), started::date - 1, started::date + 2) h
                     where h.shift_id in (bozza, bozza2)), 'clock_overlap,clock_overlap',
    'i turni registrati restano da verificare: «ha già timbrato in quelle ore», con app e con Manuale');
  perform tests.eq((select count(*)::integer
                      from public.get_hours_to_fix(tests.id('W1'), started::date - 1, started::date + 2) h
                     where h.member_id = tests.id('M_Emp2')) + r.n::integer, 3,
    'complemento: ore da sistemare + turni che contano = le tre righe di Enzo');
  perform tests.logout();
  perform tests.eq((select worked_hours from public.shift_assignments where id = uplanned), 3::numeric,
    'il fuori turno approvato vale tre ore');
  perform tests.ok((select bool_and(status = 'confirmed' and hours_source = 'clock_expected')
                      from public.shift_assignments where shift_id in (bozza, bozza2)),
    'presente, ma con le ore attese dalla timbratura');
end $$;

-- Il testo per più turni nello stesso giorno, e una persona in due aziende
-- nella stessa pubblicazione: una notifica per azienda, e `notified` le conta.
do $$
declare
  vm uuid;
  vm2 uuid;
  vm2_w2 uuid;
  m_enzo_w2 uuid;
  d date := current_date + 20;
  ids uuid[];
  r jsonb;
  n_emp integer;
  n_emp2 integer;
begin
  select x.id into vm from public.venue_members x
   where x.member_id = tests.id('M_Emp') and x.venue_id = tests.id('V1');
  select x.id into vm2 from public.venue_members x
   where x.member_id = tests.id('M_Emp2') and x.venue_id = tests.id('V2');

  -- Fixture: Olivia gestisce i turni anche in W2, ed Enzo lavora anche in V3.
  insert into public.workspace_members (workspace_id, user_id, display_name, authority, can_shifts, scope)
  values (tests.id('W2'), tests.id('Ow'), 'Olivia', 'collaborator', true, 'all');
  insert into public.workspace_members (workspace_id, user_id, display_name, authority)
  values (tests.id('W2'), tests.id('Emp2'), 'Enzo', 'none') returning id into m_enzo_w2;
  insert into public.venue_members (member_id, venue_id, workspace_id)
  values (m_enzo_w2, tests.id('V3'), tests.id('W2')) returning id into vm2_w2;

  n_emp := (select count(*)::integer from public.notifications where user_id = tests.id('Emp'));
  n_emp2 := (select count(*)::integer from public.notifications where user_id = tests.id('Emp2'));

  perform tests.login('Ow');
  ids := public.create_shifts(jsonb_build_array(
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Stesso giorno', 'draft', true,
      'require_confirmation', true,
      'dates', jsonb_build_array(d::text), 'start_time', '07:00', 'end_time', '10:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Stesso giorno', 'draft', true,
      'require_confirmation', true,
      'dates', jsonb_build_array(d::text), 'start_time', '18:00', 'end_time', '22:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Due aziende', 'draft', true,
      'dates', jsonb_build_array((d + 1)::text), 'start_time', '09:00', 'end_time', '13:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2))),
    jsonb_build_object('venue_id', tests.id('V3'), 'title', 'Due aziende', 'draft', true,
      'dates', jsonb_build_array((d + 2)::text), 'start_time', '09:00', 'end_time', '13:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2_w2)))));
  r := public.publish_shifts(ids, true);
  perform tests.eq((r ->> 'published')::integer, 4, 'quattro turni in due aziende');
  perform tests.logout();

  perform tests.eq((select title || ' | ' || body from public.notifications
                     where user_id = tests.id('Emp') and type = 'shift_published' and related_id = ids[1]),
    'Nuovi turni | V1: 2 nuovi turni per te, il ' || to_char(d, 'DD/MM') || '. Conferma la presenza.',
    'più turni nello stesso giorno: «il», non «dal … al» lo stesso giorno');
  perform tests.eq((select count(*)::integer from public.notifications
                     where user_id = tests.id('Emp2') and type = 'shift_published' and related_id = any (ids)), 2,
    'Enzo: una notifica per azienda');
  perform tests.eq((select body from public.notifications
                     where user_id = tests.id('Emp2') and type = 'shift_published' and related_id = ids[4]),
    'V3: un nuovo turno per te, il ' || to_char(d + 2, 'DD/MM') || ' dalle 09:00 alle 13:00. Conferma la presenza.',
    'quella di W2 nomina la sua sede');
  perform tests.eq((r ->> 'notified')::integer,
    (select count(*)::integer from public.notifications
      where type = 'shift_published' and related_id = any (ids)),
    'notified è il numero di notifiche create');
  perform tests.eq((r ->> 'notified')::integer, 3, 'una per Emma, due per Enzo');
  perform tests.eq((select count(*)::integer from public.notifications where user_id = tests.id('Emp')), n_emp + 1,
    'Emma, nient''altro');
  perform tests.eq((select count(*)::integer from public.notifications where user_id = tests.id('Emp2')), n_emp2 + 2,
    'Enzo, nient''altro');
end $$;

-- ---------------------------------------------------------------------------
-- Promemoria delle bozze (cron orario).
-- ---------------------------------------------------------------------------
do $$
declare
  -- L'istante del cron è **domani** alle 18:30: l'azienda di prova esiste dal
  -- momento del reset (seed: `grant_workspace_access(..., now(), ...)`), e un
  -- istante di oggi già passato la troverebbe non ancora attiva. Con «oggi alle
  -- 18:30» il test passava solo se lanciato prima delle 18:30.
  at_ timestamptz := ((current_date + 1)::timestamp + time '18:30') at time zone 'Europe/Rome';
  tom date := current_date + 2;
  n integer;
  n_emp integer;
  pubblicato uuid;
begin
  perform tests.login('Ow');
  perform public.create_shifts(jsonb_build_array(
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Cena A', 'draft', true,
      'dates', jsonb_build_array(tom::text), 'start_time', '18:00', 'end_time', '23:00'),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Cena B', 'draft', true,
      'dates', jsonb_build_array(tom::text), 'start_time', '18:00', 'end_time', '23:00'),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Lontana', 'draft', true,
      'dates', jsonb_build_array((current_date + 3)::text), 'start_time', '06:00', 'end_time', '10:00'),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Annullata', 'draft', true,
      'dates', jsonb_build_array(tom::text), 'start_time', '20:00', 'end_time', '23:00')));
  pubblicato := (public.create_shifts(jsonb_build_array(
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Pubblicato',
      'dates', jsonb_build_array(tom::text), 'start_time', '19:00', 'end_time', '23:00'))))[1];
  perform tests.logout();
  update public.shifts set status = 'cancelled' where title = 'Annullata' and venue_id = tests.id('V1');
  select count(*) into n_emp from public.notifications where user_id = tests.id('Emp');

  n := private.queue_draft_reminders(at_);
  perform tests.eq(n, 2, 'una notifica per Ow e una per Co (gestori di V1 con «Turni»)');
  perform tests.eq((select count(*)::integer from public.notifications
                     where type = 'shift_drafts_reminder' and user_id = tests.id('Ow')
                       and body = 'V1: 2 turni delle prossime 24 ore non sono ancora pubblicati. Il team non li vede.'
                       and title = 'Turni da pubblicare'), 1, 'corpo plurale');
  perform tests.eq((select count(*)::integer from public.notifications
                     where type = 'shift_drafts_reminder' and user_id = tests.id('Co')), 1, 'anche il collaboratore');
  perform tests.eq((select count(*)::integer from public.notifications where user_id = tests.id('Emp')), n_emp,
    'Emma non riceve niente');
  perform tests.eq(private.queue_draft_reminders(at_), 0, 'seconda chiamata: niente doppioni');

  -- Un solo turno: frase singolare.
  perform tests.login('Ow');
  perform public.create_shifts(jsonb_build_array(
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Brunch', 'draft', true,
      'dates', jsonb_build_array(tom::text), 'start_time', '12:00', 'end_time', '15:00')));
  perform tests.logout();
  perform tests.eq(private.queue_draft_reminders(at_ - interval '8 hours'), 0,
    'alle 10:30 il brunch di domani alle 12:00 è oltre le 24 ore, gli altri già segnati');
  perform tests.eq(private.queue_draft_reminders(at_), 2, 'il brunch parte (Ow e Co)');
  perform tests.eq((select count(*)::integer from public.notifications
                     where type = 'shift_drafts_reminder' and user_id = tests.id('Ow')
                       and body = 'V1: «Brunch» del ' || to_char(tom, 'DD/MM') || ' alle 12:00 non è ancora pubblicato. Il team non lo vede.'),
    1, 'corpo singolare');
  perform tests.eq(private.queue_draft_reminders(at_ + interval '1 hour'), 0,
    'Lontana (oltre 24 ore), la pubblicata e l''annullata non contano');
  perform tests.eq((select count(*)::integer from private.draft_reminders d
                     join public.shifts s on s.id = d.shift_id where s.title = 'Annullata'), 0,
    'l''annullata non è segnata');
  perform tests.eq((select count(*)::integer from private.draft_reminders where shift_id = pubblicato), 0,
    'il pubblicato non è segnato');

  perform tests.ok(not has_function_privilege('authenticated', 'private.queue_draft_reminders(timestamptz)', 'execute'),
    'authenticated non esegue queue_draft_reminders');
  perform tests.ok(not has_function_privilege('authenticated', 'private.run_draft_reminders()', 'execute'),
    'authenticated non esegue run_draft_reminders');
end $$;

rollback;
