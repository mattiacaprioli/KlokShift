-- Timbrature: metodo app, audit, permessi e approvazione esplicita.
begin;

do $$
declare
  ids uuid[];
  sh uuid;
  vm uuid;
  a uuid;
  rec public.shift_clock_records;
  rec2 public.shift_clock_records;
  original_in timestamptz;
  original_out timestamptz;
  corr public.shift_clock_corrections;
  reviewed public.shift_assignments;
begin
  select x.id into vm
    from public.venue_members x
   where x.member_id = tests.id('M_Emp') and x.venue_id = tests.id('V1');

  perform tests.login('Ow');
  ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Timbratura', 'date', (current_date - 1)::text,
    'start_time', '00:01', 'end_time', '23:59',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm)))));
  sh := ids[1];
  select id into a from public.shift_assignments
   where shift_id = sh and venue_member_id = vm;

  -- Il rollout è opt-in: finché la sede è manuale il professionista non timbra.
  perform tests.login('Emp');
  perform tests.raises(format('select public.clock_punch(%L, ''in'')', a),
    'clock_manual', 'il metodo manuale non espone una timbratura');

  -- Solo chi ha Ore configura la sede. L'override personale prevale.
  perform tests.login('Co');
  perform tests.raises(format('select public.set_venue_clock_method(%L, ''app'')', tests.id('V1')),
    'not_allowed', 'Turni non basta per configurare le timbrature');
  perform tests.login('Ow');
  perform public.set_venue_clock_method(tests.id('V1'), 'app');
  perform public.set_member_clock_method(vm, 'manual');
  perform tests.login('Emp');
  perform tests.raises(format('select public.clock_punch(%L, ''in'')', a),
    'clock_manual', 'l''override della scheda prevale sulla sede');
  perform tests.login('Ow');
  perform public.set_member_clock_method(vm, null);

  -- Solo l'assegnato può timbrare. Il doppio tap della stessa azione è idempotente.
  perform tests.login('Emp2');
  perform tests.raises(format('select public.clock_punch(%L, ''in'')', a),
    'not_allowed', 'un altro account non timbra al posto del professionista');
  perform tests.login('Emp');
  rec := public.clock_punch(a, 'in');
  rec2 := public.clock_punch(a, 'in');
  perform tests.eq(rec2.id, rec.id, 'doppio clock-in idempotente');
  perform tests.eq(rec.method::text, 'app', 'il record conserva il metodo usato');
  perform tests.raises(format('select public.unassign(%L)', a),
    'not_allowed', 'il professionista non usa la RPC gestionale');

  perform tests.login('Ow');
  perform tests.raises(format('select public.unassign(%L)', a),
    'attendance_started', 'una timbratura congela l''assegnazione');

  perform tests.login('Emp');
  rec := public.clock_punch(a, 'out');
  rec2 := public.clock_punch(a, 'out');
  perform tests.eq(rec2.id, rec.id, 'doppio clock-out idempotente');
  perform tests.ok(rec.clock_out_at > rec.clock_in_at, 'gli istanti arrivano dal server in ordine');
  original_in := rec.clock_in_at;
  original_out := rec.clock_out_at;
  perform tests.raises(
    format('insert into public.shift_clock_records (shift_id, venue_id, venue_member_id, method, clock_in_at) values (%L,%L,%L,''app'',now())', sh, tests.id('V1'), vm),
    'permission denied', 'nessuna scrittura diretta sulle timbrature');

  -- Turni vede il dato, Ore lo corregge e lo approva; nessuno dei due può
  -- decidere le proprie ore se collaboratore.
  perform tests.login('Co');
  perform tests.ok(exists (select 1 from public.shift_clock_records where id = rec.id),
    'chi gestisce i turni vede la timbratura');
  perform tests.raises(format('select public.approve_clock_record(%L)', a),
    'not_allowed', 'senza Ore non si approva');

  perform tests.login('Co2');
  corr := public.correct_clock_record(
    rec.id,
    ((current_date - 1)::timestamp + time '08:00') at time zone 'Europe/Rome',
    ((current_date - 1)::timestamp + time '12:10') at time zone 'Europe/Rome',
    'Orari confermati dal professionista'
  );
  perform tests.eq(corr.reason, 'Orari confermati dal professionista',
    'la motivazione resta nell''audit');
  perform tests.eq((select clock_in_at from public.shift_clock_records where id = rec.id), original_in,
    'la correzione non sovrascrive l''entrata originale');
  perform tests.eq((select clock_out_at from public.shift_clock_records where id = rec.id), original_out,
    'la correzione non sovrascrive l''uscita originale');
  perform tests.raises(format('select public.correct_clock_record(%L, null, now(), '''')', rec.id),
    'reason_required', 'la correzione vuole una motivazione');

  perform tests.eq((
    select sum(to_review_count) from public.get_workspace_hours_summary(
      tests.id('W1'), current_date - 1, current_date
    )
  ), 1::bigint, 'il riepilogo separa la timbratura da verificare');
  perform tests.eq((
    select sum(approved_hours) from public.get_workspace_hours_summary(
      tests.id('W1'), current_date - 1, current_date
    )
  ), 0::numeric, 'la proposta non entra nelle ore definitive');

  reviewed := public.approve_clock_record(a);
  perform tests.eq(reviewed.worked_hours, 4.25::numeric,
    'l''approvazione arrotonda al quarto d''ora');
  perform tests.ok(reviewed.attendance_reviewed_at is not null,
    'l''approvazione è marcata separatamente');
  perform tests.eq((
    select sum(approved_hours) from public.get_workspace_hours_summary(
      tests.id('W1'), current_date - 1, current_date
    )
  ), 4.25::numeric, 'solo dopo l''approvazione le ore sono definitive');

  -- Un annullamento conserva il record, revoca l'approvazione e sblocca la riga.
  perform tests.raises(format('select public.void_clock_record(%L, '''')', a),
    'reason_required', 'l''annullamento vuole una motivazione');
  perform tests.login('Ow');
  rec := public.void_clock_record(a, 'Timbratura di prova errata');
  perform tests.ok(rec.voided_at is not null, 'la timbratura è annullata, non cancellata');
  perform tests.eq((select worked_hours from public.shift_assignments where id = a), null::numeric,
    'annullare una proposta approvata toglie le ore derivate');
  perform public.unassign(a);
  perform tests.eq((select count(*) from public.shift_assignments where id = a), 0::bigint,
    'dopo l''annullamento l''assegnazione si può rimuovere');
  perform tests.ok(exists (
    select 1 from public.shift_clock_records where id = rec.id and assignment_id is null
  ), 'gli snapshot della timbratura sopravvivono alla rimozione');
end $$;

rollback;
select 'shift clock: ok' as result;
