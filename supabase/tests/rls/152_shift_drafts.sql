-- Turni in bozza (parte 1): il modello e chi li vede. Date future fisse.
-- Il default è «pubblicato»: un piano senza la chiave `draft` (le app già
-- installate) nasce pubblicato e avvisa come prima.
begin;

do $$
declare
  vm uuid;
  d date := current_date + 2;
  d2 date := current_date + 3;
  d3 date := current_date + 4;
  pub uuid;
  bozza uuid;
  n0 integer;
  asg uuid;
  gem uuid;
  sala uuid := gen_random_uuid();
begin
  select x.id into vm from public.venue_members x
   where x.member_id = tests.id('M_Emp') and x.venue_id = tests.id('V1');
  perform tests.logout();
  insert into public.venue_roles (id, venue_id, name) values (sala, tests.id('V1'), 'Sala');

  perform tests.login('Ow');
  perform public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Pubblicato', 'dates', jsonb_build_array(d::text),
    'start_time', '12:00', 'end_time', '15:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm)))));
  select id into pub from public.shifts where title = 'Pubblicato';
  perform tests.ok((select published_at is not null from public.shifts where id = pub),
    'senza la chiave draft il turno nasce pubblicato');
  perform tests.eq((select published_by from public.shifts where id = pub), tests.id('Ow'),
    'chi pubblica è chi crea');
  perform tests.logout();
  perform tests.eq((select count(*)::integer from public.notifications
                     where user_id = tests.id('Emp') and type = 'shift_assigned'), 1,
    'il turno pubblicato avvisa Emma');
  n0 := (select count(*)::integer from public.notifications where user_id = tests.id('Emp'));

  perform tests.login('Ow');
  perform public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Bozza', 'dates', jsonb_build_array(d::text),
    'start_time', '18:00', 'end_time', '23:00', 'draft', true,
    'role_targets', jsonb_build_array(jsonb_build_object('role_id', sala, 'count', 1)),
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm)))));
  select id into bozza from public.shifts where title = 'Bozza';
  perform tests.ok((select published_at is null and published_by is null from public.shifts where id = bozza),
    'draft true: il turno è una bozza');
  perform tests.logout();
  perform tests.eq((select count(*)::integer from public.notifications where user_id = tests.id('Emp')), n0,
    'la bozza non avvisa Emma');
  -- Un cambio turno sulla bozza non nasce dalla RPC (rifiuta le bozze): lo si
  -- scrive a mano, perché la RLS abbia una riga da nascondere.
  insert into public.shift_change_requests (assignment_id, shift_id, shift_date, requested_by, reason)
  select a.id, bozza, d, tests.id('Emp'), 'Prova' from public.shift_assignments a where a.shift_id = bozza;

  -- Dipendente: la bozza non esiste, da nessuna tabella.
  perform tests.login('Emp');
  perform tests.eq((select count(*)::integer from public.shifts where id = bozza), 0, 'Emma non vede la bozza');
  perform tests.eq((select count(*)::integer from public.shift_assignments where shift_id = bozza), 0,
    'né le sue assegnazioni');
  perform tests.eq((select count(*)::integer from public.shift_role_requirements where shift_id = bozza), 0,
    'né i ruoli richiesti');
  perform tests.eq((select count(*)::integer from public.shift_change_requests where shift_id = bozza), 0,
    'né i cambi turno');
  perform tests.eq((select count(*)::integer from public.shifts where id = pub), 1, 'il pubblicato si vede');
  perform tests.logout();
  perform tests.login('Ow');
  perform tests.eq((select count(*)::integer from public.shift_role_requirements where shift_id = bozza), 1,
    'chi gestisce vede i ruoli richiesti della bozza');
  perform tests.eq((select count(*)::integer from public.shift_change_requests where shift_id = bozza), 1,
    'e i suoi cambi turno');
  perform tests.logout();

  -- Collaboratore con «Turni» su V1: la vede. Con solo «Ore»: no.
  perform tests.login('Co');
  perform tests.eq((select count(*)::integer from public.shifts where id = bozza), 1,
    'chi ha Turni vede la bozza');
  perform tests.eq((select count(*)::integer from public.shift_assignments where shift_id = bozza), 1,
    'e le sue assegnazioni');
  perform tests.logout();
  perform tests.login('Co2');
  perform tests.eq((select count(*)::integer from public.shifts where id = bozza), 0,
    'chi ha solo Ore non vede la bozza');
  perform tests.logout();

  -- move_assignment: il gemello eredita lo stato del turno di partenza.
  perform tests.login('Ow');
  select id into asg from public.shift_assignments where shift_id = bozza;
  perform public.move_assignment(asg, null, d2);
  select s.id into gem from public.shifts s where s.date = d2 and s.title = 'Bozza';
  perform tests.ok((select published_at is null from public.shifts where id = gem),
    'il gemello di una bozza è una bozza');

  select id into asg from public.shift_assignments where shift_id = pub;
  perform public.move_assignment(asg, null, d3);
  select s.id into gem from public.shifts s where s.date = d3 and s.title = 'Pubblicato';
  perform tests.ok((select published_at is not null and published_by = tests.id('Ow') from public.shifts where id = gem),
    'il gemello di un turno pubblicato è pubblicato');
  perform tests.logout();

  -- La fixture del passato parla come la RPC vera.
  perform tests.login('Ow');
  perform tests.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Bozza scaduta', 'dates', jsonb_build_array((current_date - 3)::text),
    'start_time', '12:00', 'end_time', '15:00', 'draft', true)));
  perform tests.ok((select published_at is null from public.shifts where title = 'Bozza scaduta'),
    'tests.create_shifts: draft true -> bozza');
  perform tests.logout();
end $$;

-- Turni in bozza (parte 2): una bozza non arriva al team. Le funzioni DEFINER
-- scavalcano la RLS, quindi ognuna è una strada da chiudere: notifiche,
-- planning dei colleghi, storico, timbratura, promemoria, ore, assenze.
do $$
declare
  vm uuid;
  vm2 uuid;
  vm_ow uuid;
  d date := current_date + 5;
  past date := current_date - 5;
  sala uuid;
  f uuid;      -- bozza futura con Emma (V1)
  f2 uuid;     -- bozza futura in V2, per Enzo
  ctl uuid;    -- pubblicato in V1 lo stesso giorno: il controllo del planning
  ctl2 uuid;   -- pubblicato in V2 alla stessa ora, con Enzo: il controllo dei promemoria
  x1 uuid;     -- bozza scaduta con Emma (V1, metodo «Manuale»)
  x2 uuid;     -- bozza scaduta con Enzo (V2, timbratura dall'app)
  p uuid;      -- pubblicato concluso con Emma: il controllo delle ore
  a_f uuid;
  a_x1 uuid;
  a_x2 uuid;
  a_e uuid;
  rec uuid;
  ids uuid[];
  n_emp integer;
  n_emp2 integer;
  n_ow integer;
  r jsonb;
begin
  select x.id into vm from public.venue_members x
   where x.member_id = tests.id('M_Emp') and x.venue_id = tests.id('V1');
  select x.id into vm2 from public.venue_members x
   where x.member_id = tests.id('M_Emp2') and x.venue_id = tests.id('V2');
  select x.id into vm_ow from public.venue_members x
   where x.member_id = tests.id('M_Ow') and x.venue_id = tests.id('V1');
  select id into sala from public.venue_roles where venue_id = tests.id('V1') and name = 'Sala';
  -- Enzo timbra dall'app; V1 resta in «Manuale» (il default).
  update public.venue_members set clock_method = 'app' where id = vm2;

  perform tests.login('Ow');
  ids := public.create_shifts(jsonb_build_array(
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Bozza futura', 'dates', jsonb_build_array(d::text),
      'start_time', '18:00', 'end_time', '23:00', 'draft', true,
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Bozza V2', 'dates', jsonb_build_array(d::text),
      'start_time', '10:00', 'end_time', '12:00', 'draft', true),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Controllo V1', 'dates', jsonb_build_array(d::text),
      'start_time', '12:00', 'end_time', '15:00'),
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Controllo V2', 'dates', jsonb_build_array(d::text),
      'start_time', '18:00', 'end_time', '23:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2)))));
  f := ids[1]; f2 := ids[2]; ctl := ids[3]; ctl2 := ids[4];
  ids := tests.create_shifts(jsonb_build_array(
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Scaduta V1', 'date', past::text,
      'start_time', '12:00', 'end_time', '15:00', 'draft', true,
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Scaduta V2', 'date', past::text,
      'start_time', '12:00', 'end_time', '15:00', 'draft', true,
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2))),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Fatto', 'date', (past + 1)::text,
      'start_time', '16:00', 'end_time', '18:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm)))));
  x1 := ids[1]; x2 := ids[2]; p := ids[3];
  perform tests.logout();
  select id into a_f from public.shift_assignments where shift_id = f;
  select id into a_x1 from public.shift_assignments where shift_id = x1;
  select id into a_x2 from public.shift_assignments where shift_id = x2;

  -- ---------------------------------------------------------------------------
  -- Promemoria di timbratura: Emma timbrerebbe dall'app, ma la bozza tace.
  -- ---------------------------------------------------------------------------
  update public.venue_members set clock_method = 'app' where id = vm;
  perform tests.eq(private.queue_clock_reminders((d + time '18:06') at time zone 'Europe/Rome'), 1,
    'un solo promemoria: quello del turno pubblicato');
  perform tests.ok(not exists (select 1 from private.clock_reminders c where c.user_id = tests.id('Emp')),
    'nessun promemoria per la bozza');
  update public.venue_members set clock_method = null where id = vm;

  -- ---------------------------------------------------------------------------
  -- Lato dipendente.
  -- ---------------------------------------------------------------------------
  perform tests.login('Emp');
  perform tests.ok(exists (select 1 from public.get_staff_planning(d - 1, d + 1) g where g.shift_id = ctl),
    'il planning dei colleghi mostra il turno pubblicato');
  perform tests.ok(not exists (select 1 from public.get_staff_planning(d - 1, d + 1) g where g.shift_id = f),
    'il planning dei colleghi non mostra la bozza');
  perform tests.eq((select g.total_count from public.get_my_work_totals(past, past + 1) g), 1,
    'i totali del dipendente non contano la bozza scaduta');
  perform tests.eq((select g.total_hours from public.get_my_work_totals(past, past + 1) g), 2::numeric,
    'né le sue ore');
  perform tests.ok(not exists (select 1 from public.get_my_work_history_page(50) h where h.shift_id = x1),
    'lo storico non mostra la bozza scaduta');
  perform tests.ok(exists (select 1 from public.get_my_work_history_page(50) h where h.shift_id = p),
    'lo storico mostra il turno pubblicato');
  perform tests.ok(not exists (select 1 from public.get_my_work_history_range(past, past + 1) h where h.shift_id = x1),
    'nemmeno per periodo');
  perform tests.eq((select g.total_count from public.get_my_work_history_totals() g), 1,
    'né nei totali dello storico');
  perform tests.raises(format('select public.clock_punch(%L, ''in'')', a_f), 'shift_draft',
    'sulla bozza non si timbra');
  perform tests.raises(format('select public.respond_assignment(%L, ''confirmed'')', a_f), 'shift_draft',
    'la bozza non si conferma');
  perform tests.raises(format('select public.respond_assignment(%L, ''declined'', ''no'')', a_f), 'shift_draft',
    'né si rifiuta');
  perform tests.raises(format('select public.request_shift_change(%L, ''Ho un impegno'')', a_f), 'shift_draft',
    'né si chiede di cambiarla');
  perform tests.logout();

  -- ---------------------------------------------------------------------------
  -- Ore (V1 in «Manuale»: la bozza scaduta conterebbe da sé).
  -- ---------------------------------------------------------------------------
  perform tests.login('Ow');
  perform tests.eq((select s.shifts_count from public.get_workspace_hours_summary(tests.id('W1'), past, past + 2) s
                     where s.member_id = tests.id('M_Emp')), 1,
    'riepilogo: la bozza scaduta non è fra i turni che contano');
  perform tests.eq((select s.approved_hours from public.get_workspace_hours_summary(tests.id('W1'), past, past + 2) s
                     where s.member_id = tests.id('M_Emp')), 2::numeric,
    'né fra le ore');
  perform tests.eq((select s.hours from public.get_workspace_hours_summary(tests.id('W1'), past, past + 2) s
                     where s.member_id = tests.id('M_Emp')), 2::numeric,
    'né fra le ore pianificate');
  perform tests.ok(not exists (select 1 from public.get_workspace_hours_summary(tests.id('W1'), past, past + 2) s
                     where s.member_id = tests.id('M_Emp2')),
    'Enzo ha solo una bozza: non compare');
  perform tests.ok(not exists (select 1 from public.get_hours_to_fix(tests.id('W1'), past, past + 2) h
                     where h.shift_id in (x1, x2)),
    'la bozza scaduta non è fra le ore da sistemare');
  perform tests.eq((select s.shifts_count from public.get_hours_summary(past, past + 2) s
                     where s.member_id = tests.id('M_Emp')), 1,
    'get_hours_summary non conta la bozza');
  perform tests.eq((select s.hours from public.get_hours_summary(past, past + 2) s
                     where s.member_id = tests.id('M_Emp')), 2::numeric,
    'né le sue ore');
  perform tests.eq((select g.past_total from public.get_member_performance(tests.id('M_Emp')) g), 1,
    'la scheda non conta la bozza fra i turni passati');
  perform tests.eq((select g.total_hours from public.get_member_performance(tests.id('M_Emp')) g), 2::numeric,
    'né fra le ore');
  perform tests.ok(not exists (select 1 from public.get_member_worked_shifts(tests.id('M_Emp'), 50) w
                     where w.shift_id = x1),
    'né fra i turni lavorati');
  perform tests.ok(exists (select 1 from public.get_member_worked_shifts(tests.id('M_Emp'), 50) w
                     where w.shift_id = p),
    'dove il pubblicato c''è');

  -- Export completo: le bozze ci sono, con il loro stato.
  r := public.export_workspace_data(tests.id('W1'));
  perform tests.eq((select count(*)::integer from jsonb_array_elements(r -> 'shifts') e
                     where e ->> 'title' = 'Bozza futura' and e -> 'published_at' = 'null'::jsonb), 1,
    'l''export completo include la bozza, con published_at nullo');
  perform tests.ok((select bool_and(e ->> 'published_at' is not null) from jsonb_array_elements(r -> 'shifts') e
                     where e ->> 'title' = 'Controllo V1'),
    'e il turno pubblicato con la sua data di pubblicazione');
  perform tests.logout();

  -- Il punto in cui un'assegnazione «conta».
  perform tests.eq(private.effective_assignment_hours(a_x1), 0::numeric, 'una bozza non ha ore effettive');
  perform tests.eq(private.definitive_manual_hours(a_x1), 0::numeric, 'né ore definitive');

  -- Assenze: la bozza scaduta non è lavoro che si sovrappone.
  perform tests.ok(not private.absence_credit_conflict(tests.id('M_Emp'), past),
    'una bozza non entra in conflitto con un''assenza');
  perform tests.ok(private.absence_credit_conflict(tests.id('M_Emp'), past + 1),
    'il turno pubblicato sì');

  -- ---------------------------------------------------------------------------
  -- Timbrature e presenze sulla bozza.
  -- ---------------------------------------------------------------------------
  update public.venues set clock_auto_approve = true where id = tests.id('V1');
  insert into public.shift_clock_records (assignment_id, shift_id, venue_id, venue_member_id, method, clock_in_at)
  values (a_x1, x1, tests.id('V1'), vm, 'app', (past + time '12:00') at time zone 'Europe/Rome')
  returning id into rec;
  update public.shift_clock_records set clock_out_at = (past + time '15:00') at time zone 'Europe/Rome'
   where id = rec;
  perform tests.ok((select attendance_reviewed_at is null from public.shift_assignments where id = a_x1),
    'l''approvazione automatica salta la bozza');
  update public.venues set clock_auto_approve = false where id = tests.id('V1');

  perform tests.login('Ow');
  perform tests.eq(public.approve_regular_clock_records(tests.id('W1'), past, past, true), 0,
    'l''approvazione in blocco salta la bozza');
  perform tests.raises(format('select public.record_attendance(%L, %L::jsonb)', a_x1, '{"worked_hours": 3}'),
    'shift_draft', 'presenze: niente ore su una bozza');
  perform tests.raises(format('select public.record_attendance(%L, %L::jsonb)', a_x1, '{"status": "no_show"}'),
    'shift_draft', 'né lo stato');
  perform tests.raises(format('select public.enter_clock_record(%L, %L, %L, null)', a_x2,
      (past + time '12:00') at time zone 'Europe/Rome', (past + time '15:00') at time zone 'Europe/Rome'),
    'shift_draft', 'niente orari inseriti a mano');
  perform tests.raises(format('select public.correct_clock_record(%L, %L, null, null)', rec,
      (past + time '12:15') at time zone 'Europe/Rome'),
    'shift_draft', 'niente correzioni');
  perform tests.raises(format('select public.approve_clock_record(%L)', a_x1), 'shift_draft',
    'niente approvazione');
  perform tests.raises(format('select public.add_shift_worker(%L, %L)', x1, vm_ow), 'shift_draft',
    'niente sostituto');
  perform tests.raises(format('select public.set_shift_status(%L, ''cancelled'')', f), 'shift_draft',
    'la bozza non si annulla: si elimina');
  perform tests.logout();

  -- ---------------------------------------------------------------------------
  -- Trigger: modificare, assegnare, togliere, eliminare una bozza non avvisa.
  -- ---------------------------------------------------------------------------
  n_emp := (select count(*)::integer from public.notifications where user_id = tests.id('Emp'));
  n_emp2 := (select count(*)::integer from public.notifications where user_id = tests.id('Emp2'));
  n_ow := (select count(*)::integer from public.notifications where user_id = tests.id('Ow'));

  perform tests.login('Ow');
  perform public.update_shift(f, jsonb_build_object('title', 'Bozza futura', 'date', d::text,
    'start_time', '17:00', 'end_time', '23:00'));
  perform tests.ok((select status = 'confirmed' from public.shift_assignments where id = a_f),
    'la conferma d''ufficio del fisso resta: nessuno ha visto la bozza');
  perform public.update_shift(f, jsonb_build_object('title', 'Bozza futura', 'date', d::text,
    'start_time', '17:00', 'end_time', '23:00', 'require_confirmation', true));
  perform tests.ok((select status = 'assigned' from public.shift_assignments where id = a_f),
    'chiedere conferma su una bozza rimette in attesa chi era confermato d''ufficio');
  a_e := public.assign(f2, vm2, null);
  perform public.set_assignment_role(a_f, sala);
  perform public.unassign(a_e);
  perform tests.logout();

  -- Rifiuto e nuova conferma scritti a mano (le RPC li rifiutano sulla bozza).
  perform set_config('request.jwt.claim.sub', tests.id('Emp')::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', tests.id('Emp'))::text, true);
  update public.shift_assignments set status = 'declined' where id = a_f;
  update public.shift_assignments set status = 'confirmed', confirmed_at = now() where id = a_f;
  perform tests.logout();

  perform tests.login('Ow');
  perform public.delete_shift(f);
  perform tests.ok(not exists (select 1 from public.shifts where id = f), 'la bozza si elimina');
  perform public.delete_shift(x2);
  perform tests.ok(not exists (select 1 from public.shifts where id = x2),
    'anche scaduta e con persone: non è mai uscita');
  perform tests.raises(format('select public.delete_shift(%L)', p), 'finished_shift_locked',
    'un turno pubblicato finito con persone resta');
  perform tests.logout();

  perform tests.eq((select count(*)::integer from public.notifications where user_id = tests.id('Emp')), n_emp,
    'nessuna notifica a Emma dalla bozza');
  perform tests.eq((select count(*)::integer from public.notifications where user_id = tests.id('Emp2')), n_emp2,
    'nessuna notifica a Enzo dalla bozza');
  perform tests.eq((select count(*)::integer from public.notifications where user_id = tests.id('Ow')), n_ow,
    'nessuna notifica a chi gestisce da rifiuto o nuova conferma su una bozza');
end $$;

rollback;
