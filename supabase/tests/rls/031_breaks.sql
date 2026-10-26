-- Pausa nei turni (20261016000000_shift_breaks): scelta della sede, copia sul
-- turno, ore conteggiate, pause timbrate e correzioni.
begin;

create function tests.br_hours(p_from date, p_to date)
returns table (approved numeric, planned numeric, proposed numeric,
               paid_break numeric, unpaid_break numeric)
language sql as $$
  select coalesce(sum(s.approved_hours), 0), coalesce(sum(s.hours), 0),
         coalesce(sum(s.proposed_hours), 0),
         coalesce(sum(s.paid_break_hours), 0), coalesce(sum(s.unpaid_break_hours), 0)
    from public.get_workspace_hours_summary(tests.id('W1'), p_from, p_to) s
   where s.member_id = tests.id('M_Emp');
$$;
grant execute on function tests.br_hours(date, date) to authenticated;

create function tests.br_shift(p_vm uuid, p_date date, p_start text, p_end text,
                               p_break integer, p_extra jsonb default '{}'::jsonb)
returns uuid language plpgsql as $$
declare ids uuid[]; v_id uuid;
begin
  ids := tests.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Pausa',
    'date', p_date::text, 'start_time', p_start, 'end_time', p_end,
    'break_minutes', p_break,
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', p_vm))) || p_extra));
  select id into v_id from public.shift_assignments where shift_id = ids[1];
  return v_id;
end $$;
grant execute on function tests.br_shift(uuid, date, text, text, integer, jsonb) to authenticated;

create function tests.br_break(p_record uuid) returns text
language sql security definer as $$
  select source || ':' || minutes from private.clock_record_break(p_record);
$$;
grant execute on function tests.br_break(uuid) to authenticated;

do $$
declare
  vm uuid;
  d date := public.local_now()::date - 20;
  today date := public.local_now()::date;
  a uuid;
  a_future uuid;
  a_paid uuid;
  sh uuid;
  rec public.shift_clock_records;
  brk public.shift_clock_breaks;
  brk2 public.shift_clock_breaks;
  reviewed public.shift_assignments;
begin
  select x.id into vm from public.venue_members x
   where x.member_id = tests.id('M_Emp') and x.venue_id = tests.id('V1');

  -- ---------------------------------------------------------------------------
  -- Pausa pianificata: validazione e ore del metodo Manuale.
  -- ---------------------------------------------------------------------------
  perform tests.login('Ow');
  perform tests.raises(format('select tests.br_shift(%L, %L, ''18:00'', ''21:00'', 180)', vm, d),
    'break_too_long', 'la pausa non può coprire il turno');
  perform tests.raises(format('select tests.br_shift(%L, %L, ''18:00'', ''00:00'', -5)', vm, d),
    'break_invalid', 'pausa negativa rifiutata');

  a := tests.br_shift(vm, d, '18:00', '00:00', 30);
  perform tests.eq((select break_paid from public.shifts s join public.shift_assignments x
    on x.shift_id = s.id where x.id = a), false, 'predefinito: non retribuita');
  perform tests.eq((select approved from tests.br_hours(d, d + 1)), 5.5::numeric,
    'Manuale con pausa non retribuita: 6 h − 30 min');
  perform tests.eq((select planned from tests.br_hours(d, d + 1)), 5.5::numeric,
    'anche il programmato è al netto');
  perform tests.eq((select unpaid_break from tests.br_hours(d, d + 1)), 0.5::numeric,
    'la pausa non retribuita compare a parte');
  perform tests.eq((select paid_break from tests.br_hours(d, d + 1)), 0::numeric,
    'nessuna pausa retribuita');

  -- Un turno futuro, prima di cambiare la scelta.
  a_future := tests.br_shift(vm, today + 5, '09:00', '17:00', 30);

  -- ---------------------------------------------------------------------------
  -- La scelta della sede: solo con «Ore», e non riscrive i turni conclusi.
  -- ---------------------------------------------------------------------------
  perform tests.login('Co');
  perform tests.raises(format('select public.set_venue_break_policy(%L, true)', tests.id('V1')),
    'not_allowed', 'Turni non basta per decidere la pausa');
  perform tests.login('Co2');
  perform tests.raises(format('select public.set_venue_break_policy(%L, true, 30, 30)', tests.id('V1')),
    'break_rule_invalid', 'regola sotto l''ora rifiutata');
  perform tests.raises(format('select public.set_venue_break_policy(%L, true, 360, null)', tests.id('V1')),
    'break_rule_invalid', 'regola incompleta rifiutata');
  perform public.set_venue_break_policy(tests.id('V1'), true, 360, 30);
  perform tests.eq((select break_rule_minutes from public.venues where id = tests.id('V1')), 30,
    'la regola si salva');
  perform tests.eq((select approved from tests.br_hours(d, d + 1)), 5.5::numeric,
    'il turno concluso tiene la scelta con cui si è svolto');
  perform tests.login('Ow');
  perform tests.eq((select s.break_paid from public.shifts s join public.shift_assignments x
    on x.shift_id = s.id where x.id = a_future), true, 'il turno futuro prende la scelta nuova');

  -- Retribuita: resta nelle ore, e il client non decide la copia.
  a_paid := tests.br_shift(vm, d + 1, '18:00', '00:00', 30, '{"break_paid": false}'::jsonb);
  perform tests.eq((select s.break_paid from public.shifts s join public.shift_assignments x
    on x.shift_id = s.id where x.id = a_paid), true, 'la copia viene dalla sede, non dal payload');
  perform tests.eq((select approved from tests.br_hours(d + 1, d + 2)), 6::numeric,
    'Manuale con pausa retribuita: 6 h');
  perform tests.eq((select paid_break from tests.br_hours(d + 1, d + 2)), 0.5::numeric,
    'la pausa retribuita compare a parte');

  -- Lo storico del professionista dice lo stesso programmato.
  perform tests.login('Emp');
  perform tests.eq((select planned_hours from public.get_my_work_history_range(d, d)
    where title = 'Pausa'), 5.5::numeric, 'storico: programmato al netto');
  perform tests.eq((select planned_hours from public.get_my_work_history_range(d + 1, d + 1)
    where title = 'Pausa'), 6::numeric, 'storico: pausa retribuita inclusa');

  perform tests.login('Co2');
  perform public.set_venue_break_policy(tests.id('V1'), false);
  perform tests.login('Ow');
  perform tests.eq((select s.break_paid from public.shifts s join public.shift_assignments x
    on x.shift_id = s.id where x.id = a_future), false, 'tornare indietro vale per i futuri');

  -- ---------------------------------------------------------------------------
  -- Modifica e spostamento portano la pausa.
  -- ---------------------------------------------------------------------------
  sh := (select shift_id from public.shift_assignments where id = a_future);
  perform public.update_shift(sh, jsonb_build_object('title', 'Pausa', 'date', (today + 5)::text,
    'start_time', '09:00', 'end_time', '17:00', 'break_minutes', 45));
  perform tests.eq((select break_minutes from public.shifts where id = sh), 45, 'update_shift cambia la pausa');
  perform public.update_shift(sh, jsonb_build_object('title', 'Pausa', 'date', (today + 5)::text,
    'start_time', '09:00', 'end_time', '17:00'));
  perform tests.eq((select break_minutes from public.shifts where id = sh), 45,
    'un payload senza pausa (client vecchio) non la azzera');
  perform tests.raises(format('select public.update_shift(%L, %L::jsonb)', sh, jsonb_build_object(
    'title', 'Pausa', 'date', (today + 5)::text, 'start_time', '09:00', 'end_time', '09:30')),
    'break_too_long', 'accorciare il turno sotto la pausa è rifiutato');
  perform public.move_assignment(a_future, null, today + 6);
  perform tests.eq((select s.break_minutes from public.shifts s join public.shift_assignments x
    on x.shift_id = s.id where x.venue_member_id = vm and s.date = today + 6), 45,
    'il gemello nato dallo spostamento ha la stessa pausa');

  -- ---------------------------------------------------------------------------
  -- Pause timbrate.
  -- ---------------------------------------------------------------------------
  perform public.set_venue_clock_method(tests.id('V1'), 'app');
  a := tests.br_shift(vm, today - 1, '00:01', '23:59', 30);

  perform tests.login('Emp');
  rec := public.clock_punch(a, 'in');
  brk := public.clock_break(rec.id, 'start');
  brk2 := public.clock_break(rec.id, 'start');
  perform tests.eq(brk2.id, brk.id, 'doppio inizio pausa idempotente');
  perform tests.raises(format('insert into public.shift_clock_breaks (clock_record_id, venue_id, started_at) values (%L, %L, now())', rec.id, tests.id('V1')),
    'permission denied', 'nessuna scrittura diretta sulle pause');

  perform tests.login('Emp2');
  perform tests.raises(format('select public.clock_break(%L, ''end'')', rec.id),
    'not_allowed', 'un altro account non chiude la pausa');
  perform tests.login('Co');
  perform tests.ok(exists (select 1 from public.shift_clock_breaks where id = brk.id),
    'chi gestisce i turni vede la pausa');

  perform tests.login('Emp');
  brk := public.clock_break(rec.id, 'end');
  perform tests.ok(brk.ended_at is not null, 'fine pausa registrata');
  perform tests.eq((public.clock_break(rec.id, 'end')).id, brk.id, 'doppia fine pausa idempotente');
  -- Una seconda pausa lasciata aperta: l'uscita la chiude.
  brk2 := public.clock_break(rec.id, 'start');
  rec := public.clock_punch(a, 'out');
  perform tests.eq((select ended_at from public.shift_clock_breaks where id = brk2.id), rec.clock_out_at,
    'uscire in pausa chiude la pausa all''uscita');
  perform tests.raises(format('select public.clock_break(%L, ''start'')', rec.id),
    'clock_already_closed', 'dopo l''uscita non si apre una pausa');

  -- Orari certi per i conti: 08:00–12:10 (4 h 10 min). Le pause timbrate durano
  -- pochi istanti: contano 0 minuti e prevalgono sulla pianificata.
  perform tests.login('Co2');
  perform public.correct_clock_record(rec.id,
    ((today - 1)::timestamp + time '08:00') at time zone 'Europe/Rome',
    ((today - 1)::timestamp + time '12:10') at time zone 'Europe/Rome',
    'Orari confermati');
  perform tests.eq(split_part(tests.br_break(rec.id), ':', 1), 'clocked',
    'le pause timbrate prevalgono sulla pianificata');
  perform tests.eq((select proposed from tests.br_hours(today - 1, today)), 4.25::numeric,
    'proposta con la pausa timbrata');

  -- Il motivo è facoltativo (20261026000300). Provata in un blocco che si
  -- annulla, per non cambiare il resto.
  begin
    perform tests.ok((public.correct_clock_break(rec.id, 30, '')).reason is null,
      'anche la pausa si corregge senza motivo');
    raise exception 'rollback_probe';
  exception when others then
    if sqlerrm <> 'rollback_probe' then raise; end if;
  end;
  perform tests.raises(format('select public.correct_clock_break(%L, 300, ''x'')', rec.id),
    'break_too_long', 'la pausa corretta resta dentro la timbratura');
  perform tests.login('Emp');
  perform tests.raises(format('select public.correct_clock_break(%L, 0, ''x'')', rec.id),
    'not_allowed', 'il professionista non corregge la propria pausa');
  perform tests.login('Co');
  perform tests.raises(format('select public.correct_clock_break(%L, 0, ''x'')', rec.id),
    'not_allowed', 'senza Ore non si corregge');

  perform tests.login('Co2');
  perform public.correct_clock_break(rec.id, 30, 'Pausa pranzo comunicata');
  perform tests.eq(tests.br_break(rec.id), 'corrected:30',
    'la correzione prevale');
  perform tests.login('Emp');
  perform tests.eq((select proposed_hours from public.get_my_work_history_range(today - 1, today - 1)
    where title = 'Pausa'), 3.75::numeric,
    'nello storico la proposta da approvare toglie la pausa');
  perform tests.login('Co2');
  reviewed := public.approve_clock_record(a);
  perform tests.eq(reviewed.worked_hours, 3.75::numeric,
    'approvazione: 4 h 10 − 30 min, al quarto d''ora');
  perform tests.eq((select unpaid_break from tests.br_hours(today - 1, today)), 0.5::numeric,
    'il riepilogo porta la pausa della timbratura approvata');

  -- Correggere la pausa riapre l'approvazione, come correggere gli orari.
  perform public.correct_clock_break(rec.id, 0, 'Pausa non fatta');
  -- Nella stessa transazione le correzioni hanno lo stesso istante: si
  -- invecchia la prima, come se fosse arrivata con una richiesta precedente.
  perform tests.logout();
  update public.shift_clock_corrections set created_at = created_at - interval '1 minute'
   where clock_record_id = rec.id and corrected_break_minutes = 30;
  perform tests.login('Co2');
  perform tests.ok((select attendance_reviewed_at from public.shift_assignments where id = a) is null,
    'la correzione della pausa riapre la revisione');
  reviewed := public.approve_clock_record(a);
  perform tests.eq(reviewed.worked_hours, 4.25::numeric, 'senza pausa: 4 h 10 → 4,25 h');

  -- Senza pause timbrate vale la pianificata.
  perform tests.login('Ow');
  a := tests.br_shift(vm, today - 2, '10:00', '18:00', 30);
  perform tests.logout();
  insert into public.shift_clock_records (assignment_id, shift_id, venue_id, venue_member_id,
    method, clock_in_at, clock_out_at)
  select a, x.shift_id, tests.id('V1'), vm, 'app',
         ((today - 2)::timestamp + time '10:00') at time zone 'Europe/Rome',
         ((today - 2)::timestamp + time '18:00') at time zone 'Europe/Rome'
    from public.shift_assignments x where x.id = a;
  perform tests.login('Co2');
  perform tests.eq(tests.br_break((select id from public.shift_clock_records where assignment_id = a)), 'planned:30',
    'nessuna pausa timbrata: vale la pianificata');
  reviewed := public.approve_clock_record(a);
  perform tests.eq(reviewed.worked_hours, 7.5::numeric, '8 h timbrate − 30 min pianificati');

  -- Pausa retribuita: timbrata o no, le ore restano intere.
  perform public.set_venue_break_policy(tests.id('V1'), true);
  perform tests.login('Ow');
  a := tests.br_shift(vm, today, '00:01', '23:59', 30);
  perform tests.eq((select s.break_paid from public.shifts s join public.shift_assignments x
    on x.shift_id = s.id where x.id = a), true, 'turno in corso con la scelta nuova');
  perform tests.logout();
  insert into public.shift_clock_records (assignment_id, shift_id, venue_id, venue_member_id,
    method, clock_in_at, clock_out_at)
  select a, x.shift_id, tests.id('V1'), vm, 'app',
         (today::timestamp + time '01:00') at time zone 'Europe/Rome',
         (today::timestamp + time '05:00') at time zone 'Europe/Rome'
    from public.shift_assignments x where x.id = a;
  perform tests.login('Co2');
  reviewed := public.approve_clock_record(a);
  perform tests.eq(reviewed.worked_hours, 4::numeric, 'pausa retribuita: 4 h restano 4 h');
  perform public.set_venue_break_policy(tests.id('V1'), false);

  -- ---------------------------------------------------------------------------
  -- Pausa fissa (20261022000000): la sede decide, la persona può fare eccezione,
  -- la timbratura tiene la scelta con cui è entrata.
  -- ---------------------------------------------------------------------------
  perform tests.login('Co');
  perform tests.raises(format('select public.set_venue_break_clocked(%L, false)', tests.id('V1')),
    'not_allowed', 'Turni non basta per decidere come si registra la pausa');
  perform tests.raises(format('select public.set_member_break_clocked(%L, true)', vm),
    'not_allowed', 'Turni non basta per l''eccezione della persona');
  perform tests.login('Co2');
  perform public.set_venue_break_clocked(tests.id('V1'), false);

  perform tests.login('Ow');
  a := tests.br_shift(vm, today + 1, '08:00', '12:00', 30);
  perform tests.login('Emp');
  rec := public.clock_punch(a, 'in');
  perform tests.eq(rec.break_clocked, false, 'la timbratura copia la pausa fissa della sede');
  perform tests.raises(format('select public.clock_break(%L, ''start'')', rec.id),
    'break_not_clocked', 'con la pausa fissa non si timbra l''inizio pausa');
  rec := public.clock_punch(a, 'out');
  perform tests.login('Co2');
  perform tests.eq(tests.br_break(rec.id), 'planned:30', 'pausa fissa: vale la pianificata');
  perform public.correct_clock_break(rec.id, 0, 'Pausa non fatta, comunicata');
  perform tests.eq(tests.br_break(rec.id), 'corrected:0', 'chi gestisce corregge anche la pausa fissa');

  -- Eccezione per la persona: timbra lei, anche se la sede è fissa.
  perform public.set_member_break_clocked(vm, true);
  perform tests.login('Ow');
  a := tests.br_shift(vm, today + 1, '14:00', '18:00', 30);
  perform tests.login('Emp');
  rec := public.clock_punch(a, 'in');
  perform tests.eq(rec.break_clocked, true, 'l''eccezione della persona prevale sulla sede');
  brk := public.clock_break(rec.id, 'start');
  perform tests.ok(brk.id is not null, 'con l''eccezione la pausa si timbra');

  -- Tornare «come la sede» non tocca la timbratura già aperta.
  perform tests.login('Co2');
  perform public.set_member_break_clocked(vm);
  perform tests.eq((select break_clocked from public.venue_members where id = vm), null::boolean,
    'senza valore torna a seguire la sede');
  perform tests.eq((select break_clocked from public.shift_clock_records where id = rec.id), true,
    'la timbratura aperta tiene la scelta con cui è entrata');
  perform tests.login('Emp');
  brk := public.clock_break(rec.id, 'end');
  perform tests.ok(brk.ended_at is not null, 'la pausa iniziata si chiude');
  perform public.clock_punch(a, 'out');
end $$;

rollback;
select 'breaks: ok' as result;
