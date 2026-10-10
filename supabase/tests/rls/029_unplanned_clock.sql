-- Timbratura senza turno: abilitazione per persona, turno che nasce all'uscita,
-- approvazione esplicita, uscita dimenticata e annullamento.
begin;

do $$
declare
  vm uuid;
  ids uuid[];
  rec public.shift_clock_records;
  rec2 public.shift_clock_records;
  open_id uuid;
  sh public.shifts;
  asg public.shift_assignments;
  started timestamptz;
begin
  select x.id into vm
    from public.venue_members x
   where x.member_id = tests.id('M_Emp') and x.venue_id = tests.id('V1');

  -- Spenta di default, e la accende solo chi ha Ore.
  perform tests.login('Ow');
  perform public.set_venue_clock_method(tests.id('V1'), 'app');
  perform tests.login('Emp');
  perform tests.raises(format('select public.clock_punch_unplanned(%L, ''in'')', vm),
    'clock_unplanned_disabled', 'senza abilitazione non si timbra fuori turno');
  perform tests.raises(format('select public.set_member_clock_unplanned(%L, true)', vm),
    'not_allowed', 'il professionista non si abilita da sé');
  perform tests.login('Co');
  perform tests.raises(format('select public.set_member_clock_unplanned(%L, true)', vm),
    'not_allowed', 'Turni non basta per abilitare');
  perform tests.login('Co2');
  perform public.set_member_clock_unplanned(vm, true);

  -- Il metodo manuale vince sull'abilitazione: non c'è niente da timbrare.
  perform tests.login('Ow');
  perform public.set_member_clock_method(vm, 'manual');
  perform tests.login('Emp');
  perform tests.raises(format('select public.clock_punch_unplanned(%L, ''in'')', vm),
    'clock_manual', 'con il metodo manuale non si timbra');
  perform tests.eq((select count(*) from public.get_my_unplanned_clock()), 0::bigint,
    'e la Home non lo propone');
  perform tests.login('Ow');
  perform public.set_member_clock_method(vm, null);

  -- Un turno pianificato in corso si timbra, non si scavalca.
  ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Pianificato',
    'date', (public.local_now() - interval '10 minutes')::date::text,
    'start_time', to_char(public.local_now() - interval '10 minutes', 'HH24:MI'),
    'end_time', to_char(public.local_now() + interval '50 minutes', 'HH24:MI'),
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm)))));
  perform tests.login('Emp');
  perform tests.raises(format('select public.clock_punch_unplanned(%L, ''in'')', vm),
    'clock_planned_shift', 'con un turno in corso si timbra quello');
  perform tests.login('Ow');
  perform public.delete_shift(ids[1]);

  -- Solo l'interessato timbra, e una mansione che non ha non si sceglie.
  perform tests.login('Emp2');
  perform tests.raises(format('select public.clock_punch_unplanned(%L, ''in'')', vm),
    'not_allowed', 'un altro account non timbra al posto suo');
  perform tests.login('Emp');
  perform tests.raises(format('select public.clock_punch_unplanned(%L, ''in'', %L)', vm, gen_random_uuid()),
    'role_not_in_venue', 'la mansione deve essere sua in questa sede');

  rec := public.clock_punch_unplanned(vm, 'in', null, '  Inventario  ');
  rec2 := public.clock_punch_unplanned(vm, 'in');
  perform tests.eq(rec2.id, rec.id, 'doppia entrata idempotente');
  perform tests.ok(rec.shift_id is null and rec.assignment_id is null,
    'l''entrata non crea ancora un turno');
  perform tests.eq(rec.note, 'Inventario', 'la nota è ripulita');
  perform tests.eq((select open_record_id from public.get_my_unplanned_clock() where venue_member_id = vm),
    rec.id, 'la Home vede l''entrata aperta');

  -- Chi vede le timbrature la vede; solo chi ha Ore la gestisce.
  perform tests.login('Co');
  perform tests.eq((select can_manage from public.get_open_unplanned_clocks(tests.id('W1')) where record_id = rec.id),
    false, 'Turni vede la timbratura aperta ma non la gestisce');
  perform tests.raises(format('select public.void_unplanned_clock(%L, ''x'')', rec.id),
    'not_allowed', 'senza Ore non si annulla');
  perform tests.login('Co2');
  perform tests.eq((select can_manage from public.get_open_unplanned_clocks(tests.id('W1')) where record_id = rec.id),
    true, 'Ore la gestisce');
  perform tests.login('Emp2');
  perform tests.eq((select count(*) from public.get_open_unplanned_clocks(tests.id('W1'))), 0::bigint,
    'un collega non la vede');

  -- Una sola entrata aperta per account, anche in un'altra azienda.
  perform tests.login('Emp');
  perform public.add_member(tests.id('W2'), '{}'::jsonb, 'none', '{}'::jsonb, 'all',
    jsonb_build_array(jsonb_build_object('venue_id', tests.id('V3'))), true);
  perform public.set_venue_clock_method(tests.id('V3'), 'app');
  perform public.set_member_clock_unplanned(
    (select x.id from public.venue_members x where x.member_id = tests.id('M_Emp_W2')), true);
  perform tests.raises(format('select public.clock_punch_unplanned(%L, ''in'')',
      (select x.id from public.venue_members x where x.member_id = tests.id('M_Emp_W2'))),
    'clock_already_open', 'prima si esce dall''altra sede');

  -- L'uscita fa nascere il turno, confermato e da approvare, senza notifiche.
  -- In transazione now() è fermo: l'entrata va indietro perché il turno risulti
  -- già concluso.
  perform tests.logout();
  update public.shift_clock_records set clock_in_at = now() - interval '3 hours'
   where venue_member_id = vm and shift_id is null and voided_at is null;
  perform tests.login('Emp');
  rec := public.clock_punch_unplanned(vm, 'out');
  rec2 := public.clock_punch_unplanned(vm, 'out');
  perform tests.eq(rec2.id, rec.id, 'doppia uscita idempotente');
  select * into sh from public.shifts where id = rec.shift_id;
  select * into asg from public.shift_assignments where id = rec.assignment_id;
  perform tests.ok(sh.unplanned, 'il turno è marcato fuori turno');
  perform tests.eq(sh.title, 'Fuori turno', 'con il titolo che lo dice');
  perform tests.eq(sh.description, 'Inventario', 'e la nota del professionista');
  perform tests.eq(sh.venue_id, tests.id('V1'), 'nella sede della timbratura');
  perform tests.ok(sh.end_time > sh.start_time, 'mai lungo zero');
  perform tests.eq(asg.status::text, 'confirmed', 'chi ha lavorato non deve confermare');
  perform tests.eq(asg.hours_source, 'clock_expected', 'le ore vengono dalla timbratura');
  perform tests.ok(asg.worked_hours is null and asg.attendance_reviewed_at is null,
    'nessuna approvazione d''ufficio');
  perform tests.logout();
  perform tests.eq((select count(*) from public.notifications
                     where type in ('shift_assigned', 'shift_unassigned') and related_id is not distinct from sh.id),
    0::bigint, 'nessuna notifica di turno assegnato');

  perform tests.login('Co2');
  perform tests.eq((select sum(to_review_count) from public.get_workspace_hours_summary(
      tests.id('W1'), sh.date, sh.date + 1)), 1::bigint, 'il riepilogo la mette da verificare');
  perform tests.eq((select sum(approved_hours) from public.get_workspace_hours_summary(
      tests.id('W1'), sh.date, sh.date + 1)), 0::numeric, 'senza ore definitive');

  -- I colleghi la vedono nel planning solo dopo l'approvazione.
  perform tests.logout();
  update public.venues set staff_sees_planning = true where id = tests.id('V1');
  perform tests.login('Ow');
  perform tests.eq((select count(*) from public.get_staff_planning(sh.date, sh.date) where shift_id = sh.id),
    0::bigint, 'prima dell''approvazione non è nel planning dei colleghi');
  perform tests.login('Co2');
  perform public.approve_clock_record(asg.id);
  perform tests.login('Ow');
  perform tests.eq((select count(*) from public.get_staff_planning(sh.date, sh.date) where shift_id = sh.id),
    1::bigint, 'dopo sì');

  -- Entrata per errore: chi ha Ore la annulla, il record resta.
  perform tests.login('Emp');
  rec := public.clock_punch_unplanned(vm, 'in');
  open_id := rec.id;
  perform tests.login('Co2');
  perform tests.raises(format('select public.void_unplanned_clock(%L, '' '')', open_id),
    'reason_required', 'l''annullamento vuole un motivo');
  rec := public.void_unplanned_clock(open_id, 'Timbrata per errore');
  perform tests.ok(rec.voided_at is not null and rec.shift_id is null, 'annullata, non cancellata');

  -- Uscita dimenticata: oltre 16 ore la chiude chi gestisce, con un motivo.
  perform tests.login('Emp');
  rec := public.clock_punch_unplanned(vm, 'in');
  perform tests.logout();
  started := date_trunc('minute', now() - interval '20 hours');
  update public.shift_clock_records set clock_in_at = started where id = rec.id;
  perform tests.login('Emp');
  perform tests.raises(format('select public.clock_punch_unplanned(%L, ''out'')', vm),
    'clock_open_too_long', 'dopo 16 ore l''uscita non la registra il professionista');
  perform tests.raises(format('select public.close_unplanned_clock(%L, now(), ''x'')', rec.id),
    'not_allowed', 'né la chiude da sé');
  perform tests.login('Co2');
  perform tests.raises(format('select public.close_unplanned_clock(%L, %L, ''x'')', rec.id, started - interval '1 hour'),
    'invalid_clock_interval', 'l''uscita viene dopo l''entrata');
  rec := public.close_unplanned_clock(rec.id, started + interval '8 hours', 'Uscita confermata a voce');
  perform tests.ok(rec.clock_out_at is null, 'l''uscita originale resta vuota');
  perform tests.eq((select count(*) from public.shift_clock_corrections where clock_record_id = rec.id),
    1::bigint, 'l''uscita è una correzione con motivo');
  perform tests.logout();
  select * into sh from public.shifts where id = rec.shift_id;
  perform tests.eq(public.shift_duration_hours(sh.start_time, sh.end_time), 8::numeric,
    'il turno nasce con gli orari corretti');
  perform tests.login('Co2');

  -- Annullare la timbratura del fuori turno toglie il turno, in silenzio.
  rec := public.void_clock_record(rec.assignment_id, 'Giornata registrata due volte');
  perform tests.ok(rec.voided_at is not null, 'la timbratura resta annullata');
  perform tests.eq((select count(*) from public.shifts where id = sh.id), 0::bigint,
    'il turno che esisteva solo per lei non c''è più');
  perform tests.logout();
  perform tests.eq((select count(*) from public.notifications
                     where type = 'shift_unassigned' and user_id = tests.id('Emp')),
    0::bigint, 'nessuna notifica di turno revocato');

  -- Spegnerla non chiude un'entrata già aperta.
  perform tests.login('Emp');
  rec := public.clock_punch_unplanned(vm, 'in');
  perform tests.login('Co2');
  perform public.set_member_clock_unplanned(vm, false);
  perform tests.login('Emp');
  perform tests.eq((select open_record_id from public.get_my_unplanned_clock() where venue_member_id = vm),
    rec.id, 'spenta dopo l''entrata, l''uscita resta in Home');
  rec := public.clock_punch_unplanned(vm, 'out');
  perform tests.ok(rec.shift_id is not null, 'e si registra');
  perform tests.raises(format('select public.clock_punch_unplanned(%L, ''in'')', vm),
    'clock_unplanned_disabled', 'ma una nuova entrata no');
end $$;

rollback;
select 'unplanned clock: ok' as result;
