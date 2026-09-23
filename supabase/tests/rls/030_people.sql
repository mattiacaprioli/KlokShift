-- Matrice C: assenze, cambi turno, chat, documenti, report, carriera, eliminazione.
begin;

create function pg_temp.vm(p_member text, p_venue text) returns uuid language sql as $$
  select id from public.venue_members where member_id = tests.id(p_member) and venue_id = tests.id(p_venue)
$$;
grant execute on function pg_temp.vm(text, text) to public;

-- ---------------------------------------------------------------------------
-- Assenze
-- ---------------------------------------------------------------------------
do $$
declare
  ab uuid; ab2 uuid; sick uuid; r record; conv uuid;
  d1 date := current_date + 10; d2 date := current_date + 12;
begin
  perform tests.login('Emp');
  ab := public.request_absence(tests.id('W1'), 'ferie', d1, d2, null, null, 'mare');
  perform tests.logout();
  perform tests.ok(exists (select 1 from public.notifications
                            where user_id = tests.id('Ow') and type = 'absence_request' and body like 'Emma chiede le ferie %'),
    'la notifica nomina la persona col nome della scheda');
  perform tests.login('Emp');
  perform tests.eq((select status::text from public.staff_absences where id = ab), 'pending', 'le ferie nascono da approvare');
  perform tests.raises(format($f$select public.request_absence(%L, 'ferie', %L, %L)$f$, tests.id('W1'), d1 + 1, d2 + 1),
    'C''è già un''assenza', 'niente sovrapposizioni');
  perform tests.raises(format($f$select public.request_absence(%L, 'ferie', %L, %L)$f$, tests.id('W1'), current_date - 3, current_date - 2),
    'giorni già passati', 'le ferie non si chiedono all''indietro');
  perform tests.login('Emp2');
  perform tests.raises(format($f$select public.request_absence(%L, 'ferie', %L, %L)$f$, tests.id('W2'), d1, d2),
    'Non fai parte', 'solo nell''azienda in cui sono attivo');
  perform tests.login('Emp');

  -- Malattia: approvata d'ufficio, ammessa anche a cose fatte, mai con nota.
  sick := public.request_absence(tests.id('W1'), 'malattia', current_date - 2, current_date - 1, null, null, 'febbre', 'CERT123');
  select status, note, inps_protocol into r from public.staff_absences where id = sick;
  perform tests.eq(r.status::text, 'approved', 'la malattia è approvata d''ufficio');
  perform tests.ok(r.note is null, 'e non porta la nota (dato sanitario)');
  perform tests.eq(r.inps_protocol, 'CERT123', 'ma il riferimento del certificato sì');
  perform tests.raises('update public.staff_absences set note = ''x''', 'permission denied', 'nessuna scrittura diretta');

  -- Card in chat + notifica al titolare (con il riferimento alla conversazione).
  perform tests.eq((select count(*) from public.messages where absence_id = ab), 1::bigint, 'card in chat');
  perform tests.logout();
  perform tests.ok(exists (select 1 from public.notifications n where n.user_id = tests.id('Ow') and n.type = 'absence_request' and n.related_id is not null),
    'il titolare riceve la richiesta con la chat');

  -- Chi la vede.
  perform tests.login('Emp2'); perform tests.eq((select count(*) from public.staff_absences), 0::bigint, 'Emp2 non vede le assenze di Emp');
  perform tests.login('Co');   perform tests.eq((select count(*) from public.staff_absences), 0::bigint, 'Co (senza «Staff») nemmeno');
  perform tests.login('Emp');  perform tests.eq((select count(*) from public.staff_absences), 2::bigint, 'Emp vede le proprie');
  perform tests.login('Ow');   perform tests.eq((select count(*) from public.staff_absences), 2::bigint, 'il titolare vede quelle dell''azienda');

  -- Chi decide.
  perform tests.login('Co');
  perform tests.raises(format('select public.resolve_absence(%L, true)', ab), 'Non sei tu a decidere', 'Co senza «Staff» non decide');
  perform tests.login('Ow');
  perform public.resolve_absence(ab, true, 'buone vacanze');
  perform tests.eq((select status::text from public.staff_absences where id = ab), 'approved', 'il titolare approva');
  perform tests.logout();
  perform tests.ok(exists (select 1 from public.notifications where user_id = tests.id('Emp') and type = 'absence_response' and title = 'Ferie approvate'),
    'Emp è avvisato');

  -- Registrare / ritirare.
  perform tests.login('Ow');
  perform public.record_absence(tests.id('M_Ow'), 'permesso', d1, d1, '09:00', '11:00');  -- il titolare le proprie: sì
  perform tests.login('Co');
  perform tests.raises(format($f$select public.record_absence(%L, 'permesso', %L, %L)$f$, tests.id('M_Co'), d1, d1),
    'Persona non trovata', 'Co non registra le proprie: le chiede');
  perform tests.login('Emp');
  perform public.withdraw_absence(ab);
  perform tests.eq((select status::text from public.staff_absences where id = ab), 'withdrawn', 'Emp ritira una richiesta futura');
  perform tests.raises(format('select public.withdraw_absence(%L)', sick), 'già cominciata', 'una malattia in corso non si ritira');

  -- Riepilogo per l'export (solo chi ha «Ore» o è titolare).
  perform tests.login('Ow');
  perform public.record_absence(tests.id('M_Emp'), 'ferie', d1 + 30, d1 + 32);
  perform tests.eq((select ferie_days from public.get_absence_summary(d1 + 29, d1 + 40) where member_id = tests.id('M_Emp')), 3, 'giorni di ferie nel periodo');
  perform tests.login('Emp2');
  perform tests.eq((select count(*) from public.get_absence_summary(d1 - 100, d1 + 100)), 0::bigint, 'Emp2 non ha riepiloghi');

  perform tests.logout();
end $$;

-- ---------------------------------------------------------------------------
-- Cambi turno
-- ---------------------------------------------------------------------------
do $$
declare
  ids uuid[]; sh uuid; a_emp uuid; a_co uuid; req uuid; req2 uuid;
  v_emp uuid := pg_temp.vm('M_Emp', 'V1'); v_co uuid := pg_temp.vm('M_Co', 'V1');
begin
  perform tests.login('Ow');
  ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Pranzo', 'date', (current_date + 3)::text, 'start_time', '12:00', 'end_time', '16:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', v_emp)))));
  sh := ids[1];
  select id into a_emp from public.shift_assignments where shift_id = sh and venue_member_id = v_emp;

  perform tests.login('Co');
  perform tests.raises(format($f$select public.request_shift_change(%L, 'perché')$f$, a_emp), 'Non è il tuo turno', 'non si chiede per un altro');
  perform tests.login('Emp');
  perform tests.raises(format($f$select public.request_shift_change(%L, '  ')$f$, a_emp), 'Scrivi il motivo', 'motivo obbligatorio');
  req := public.request_shift_change(a_emp, 'ho un esame');
  perform tests.raises(format($f$select public.request_shift_change(%L, 'ancora')$f$, a_emp), 'già una richiesta aperta', 'una alla volta');
  perform tests.eq((select count(*) from public.messages where request_id = req), 1::bigint, 'card in chat');
  perform tests.logout();
  perform tests.ok(exists (select 1 from public.notifications where user_id = tests.id('Ow') and type = 'shift_change_request' and related_id is not null), 'il titolare: con la chat');
  perform tests.ok(exists (select 1 from public.notifications where user_id = tests.id('Co') and type = 'shift_change_request' and related_id is null), 'chi ha «Turni»: senza riferimento alla chat');

  -- Chi non ha «Turni» non decide; chi li ha sì, con un sostituto.
  perform tests.login('Co2');
  perform tests.raises(format('select public.resolve_shift_change_request(%L, true)', req), 'Non sei tu a decidere', 'Co2 non ha «Turni»');
  perform tests.login('Co');
  perform public.resolve_shift_change_request(req, true, v_co, 'ok');
  perform tests.eq((select count(*) from public.shift_assignments where id = a_emp), 0::bigint, 'Emp è fuori dal turno');
  perform tests.eq((select count(*) from public.shift_assignments where shift_id = sh and venue_member_id = v_co), 1::bigint, 'il sostituto è dentro');

  -- «Non decidi di te stesso»: Co non decide sulla propria richiesta, il titolare sì.
  select id into a_co from public.shift_assignments where shift_id = sh and venue_member_id = v_co;
  req2 := public.request_shift_change(a_co, 'anch''io');
  perform tests.raises(format('select public.resolve_shift_change_request(%L, false)', req2), 'Non sei tu a decidere', 'Co non decide sul proprio turno');
  perform tests.login('Ow');
  perform public.resolve_shift_change_request(req2, false, null, 'no');
  perform tests.eq((select status::text from public.shift_change_requests where id = req2), 'rejected', 'il titolare rifiuta');
  perform tests.logout();
end $$;

-- ---------------------------------------------------------------------------
-- Chat
-- ---------------------------------------------------------------------------
do $$
declare
  c1 uuid; c2 uuid; n bigint;
begin
  perform tests.login('Ow');
  c1 := public.open_conversation(p_member => tests.id('M_Emp'));
  perform tests.raises(format('select public.open_conversation(p_member => %L)', tests.id('M_Ow')), 'not_allowed', 'non con sé stessi');
  perform tests.login('Str');
  perform tests.raises(format('select public.open_conversation(p_member => %L)', tests.id('M_Emp')), 'not_allowed', 'da fuori azienda non si scrive');
  perform tests.login('Emp');
  c2 := public.open_conversation(p_workspace => tests.id('W1'));
  perform tests.eq(c2, c1, 'una conversazione per coppia, da qualunque lato si apra');

  -- Testo sì; card e mittente falso no.
  insert into public.messages (conversation_id, sender_id, content) values (c1, tests.id('Emp'), 'ciao');
  perform tests.raises(format($f$insert into public.messages (conversation_id, sender_id, content, kind) values (%L, %L, 'x', 'absence_request')$f$, c1, tests.id('Emp')),
    'permission denied', 'le card le scrivono solo le RPC');
  perform tests.raises(format($f$insert into public.messages (conversation_id, sender_id, content) values (%L, %L, 'x')$f$, c1, tests.id('Ow')),
    'row-level security', 'non si scrive a nome di un altro');
  perform tests.login('Emp2');
  perform tests.eq((select count(*) from public.messages), 0::bigint, 'Emp2 non legge la conversazione di Emp');
  perform tests.raises(format($f$insert into public.messages (conversation_id, sender_id, content) values (%L, %L, 'x')$f$, c1, tests.id('Emp2')),
    'row-level security', 'né ci scrive');

  -- Non letti e notifica (dedupe).
  perform tests.login('Emp');
  insert into public.messages (conversation_id, sender_id, content) values (c1, tests.id('Emp'), 'ci sei?');
  perform tests.logout();
  perform tests.eq((select count(*) from public.notifications where user_id = tests.id('Ow') and type = 'new_message' and related_id = c1), 1::bigint,
    'una sola notifica finché non si legge');
  perform tests.login('Ow');
  perform tests.ok(public.get_chat_unread_count() >= 2, 'messaggi non letti');
  perform public.mark_conversation_read(c1);
  perform tests.eq((select count(*) from public.messages where conversation_id = c1 and read_at is null and sender_id <> tests.id('Ow')), 0::bigint, 'letti');
  perform tests.eq(public.get_chat_unread_count(), 1, 'resta solo la card di Co, in un''altra conversazione');
  -- Il titolare vede il professionista per nome, senza sottotitolo; il
  -- professionista vede il titolare per nome, con sotto l'azienda (due sedi:
  -- l'azienda, non una sede).
  -- Il nome è quello della scheda («Emma»), non quello del profilo («Emma
  -- Employee»): dentro l'azienda vince chi l'ha messa in organico.
  perform tests.eq((select name from public.get_chat_counterparts(array[c1])), 'Emma', 'il titolare vede il professionista col nome della scheda');
  perform tests.ok((select subtitle is null from public.get_chat_counterparts(array[c1])), 'il professionista non ha sottotitolo');
  insert into public.messages (conversation_id, sender_id, content) values (c1, tests.id('Ow'), 'tutto ok?');
  perform tests.login('Emp');
  perform tests.eq((select name from public.get_chat_counterparts(array[c1])), 'Olivia Owner', 'il professionista vede il titolare per nome');
  perform tests.eq((select subtitle from public.get_chat_counterparts(array[c1])), 'W1', 'e sotto l''azienda');
  perform tests.ok((select body like 'Olivia Owner (W1): %' from public.notifications
                     where user_id = tests.id('Emp') and type = 'new_message' and related_id = c1
                     order by created_at desc limit 1),
    'la notifica nomina persona e azienda');
  perform tests.logout();
end $$;

-- ---------------------------------------------------------------------------
-- Chat fra colleghi
-- ---------------------------------------------------------------------------
do $$
declare
  c3 uuid; c4 uuid;
begin
  -- Due dipendenti della stessa azienda, che non condividono nemmeno la sede
  -- (Emp sta in V1, Emp2 in V2): l'ambito è l'azienda.
  perform tests.login('Emp');
  c3 := public.open_conversation(p_member => tests.id('M_Emp2'));
  perform tests.eq(public.open_conversation(p_member => tests.id('M_Emp2')), c3, 'una sola conversazione per coppia');
  insert into public.messages (conversation_id, sender_id, content) values (c3, tests.id('Emp'), 'ciao Enzo');
  perform tests.login('Emp2');
  perform tests.eq(public.open_conversation(p_member => tests.id('M_Emp')), c3, 'la stessa da entrambi i lati, in qualunque ordine');
  perform tests.eq((select count(*) from public.messages where conversation_id = c3), 1::bigint, 'e la legge');
  -- Un collega è una persona, con sotto l'azienda del thread: nessuno dei due
  -- parla a nome dell'azienda, quindi niente insegna al posto del nome.
  perform tests.eq((select name from public.get_chat_counterparts(array[c3])), 'Emma', 'il collega per nome (della scheda)');
  perform tests.eq((select subtitle from public.get_chat_counterparts(array[c3])), 'W1', 'con l''azienda sotto');
  perform tests.ok((select body like 'Emma (W1): %' from public.notifications
                     where user_id = tests.id('Emp2') and type = 'new_message' and related_id = c3),
    'e la notifica dice lo stesso');

  -- I collaboratori sono membri come gli altri.
  perform tests.login('Co');
  c4 := public.open_conversation(p_member => tests.id('M_Emp'));
  perform tests.ok(c4 <> c3, 'un thread per coppia, non uno per azienda');

  -- Da fuori non si entra, nemmeno conoscendo l'id del membro.
  perform tests.login('Str');
  perform tests.raises(format('select public.open_conversation(p_member => %L)', tests.id('M_Emp2')), 'not_allowed', 'l''estraneo resta fuori');
  perform tests.eq((select count(*) from public.get_workspace_contacts()), 0::bigint, 'e ha la rubrica vuota');

  -- La rubrica: Emp è dipendente in W1 e titolare in W2, e vede le due aziende.
  perform tests.login('Emp');
  perform tests.eq((select count(*) from public.get_workspace_contacts() where workspace_name = 'W1'), 4::bigint,
    'in W1: titolare, due collaboratori e un collega');
  perform tests.ok((select bool_and(user_id <> tests.id('Emp')) from public.get_workspace_contacts()), 'mai sé stessi');
  perform tests.eq((select venues from public.get_workspace_contacts() where user_id = tests.id('Emp2')), 'V2', 'con la sede in cui lavora');
  perform tests.eq((select name from public.get_workspace_contacts() where user_id = tests.id('Emp2')), 'Enzo', 'e col nome della scheda');

  -- L'interruttore: spento, i dipendenti non si scrivono più fra loro, ma chi
  -- gestisce resta raggiungibile.
  perform tests.login('Ow');
  update public.workspaces set staff_can_chat = false where id = tests.id('W1');
  perform tests.login('Emp');
  perform tests.raises(format('select public.open_conversation(p_member => %L)', tests.id('M_Emp2')), 'chat_disabled', 'chat fra colleghi spenta');
  perform tests.eq((select count(*) from public.get_workspace_contacts() where workspace_name = 'W1'), 3::bigint, 'in rubrica restano solo titolare e collaboratori');
  perform tests.ok(public.open_conversation(p_member => tests.id('M_Ow')) is not null, 'al titolare si scrive sempre');
  perform tests.ok(public.open_conversation(p_member => tests.id('M_Co')) is not null, 'e a chi gestisce anche');
  -- L'interruttore è del titolare, non di chi ci lavora: la policy scarta la
  -- riga, e l'UPDATE tocca zero righe **senza sollevare** (vedi AGENTS.md).
  update public.workspaces set staff_can_chat = true where id = tests.id('W1');
  perform tests.ok((select not staff_can_chat from public.workspaces where id = tests.id('W1')),
    'il dipendente non se lo riaccende');
  perform tests.logout();
end $$;

-- ---------------------------------------------------------------------------
-- Documenti (tabella e storage)
-- ---------------------------------------------------------------------------
do $$
declare
  m_emp text := tests.id('M_Emp')::text;
begin
  perform tests.login('Ow');
  insert into public.staff_documents (member_id, name, storage_path) values (tests.id('M_Emp'), 'HACCP', m_emp || '/haccp.pdf');
  perform tests.raises(format($f$insert into public.staff_documents (member_id, uploaded_by, name, storage_path) values (%L, %L, 'x', '%s/forged.pdf')$f$,
    tests.id('M_Emp'), tests.id('Ow'), m_emp), 'permission denied', 'uploaded_by lo decide il trigger, non il client');
  perform tests.raises(format($f$insert into public.staff_documents (member_id, name, storage_path) values (%L, 'x', 'altro/x.pdf')$f$, tests.id('M_Emp')),
    'staff_documents_path_owner_ck', 'il file sta nella cartella della persona');
  perform tests.eq((select uploaded_by from public.staff_documents), tests.id('Ow'), 'chi carica è registrato dal server');
  insert into storage.objects (bucket_id, name) values ('staff-documents', m_emp || '/haccp.pdf');

  perform tests.login('Emp');
  perform tests.eq((select count(*) from public.staff_documents), 1::bigint, 'la persona vede i propri documenti');
  perform tests.eq((select count(*) from storage.objects where bucket_id = 'staff-documents'), 1::bigint, 'e il proprio file');
  perform tests.login('Emp2');
  perform tests.eq((select count(*) from public.staff_documents), 0::bigint, 'un collega no');
  perform tests.eq((select count(*) from storage.objects where bucket_id = 'staff-documents'), 0::bigint, 'né il file');
  perform tests.raises(format($f$insert into storage.objects (bucket_id, name) values ('staff-documents', '%s/x.pdf')$f$, m_emp),
    'row-level security', 'né lo carica');
  perform tests.login('Co');
  perform tests.raises(format($f$insert into public.staff_documents (member_id, name, storage_path) values (%L, 'x', '%s/x.pdf')$f$, tests.id('M_Emp'), m_emp),
    'row-level security', 'Co non ha «Documenti»');
  perform tests.login('Ow');  -- Ow è già titolare: ha tutto
  perform tests.logout();
end $$;

-- ---------------------------------------------------------------------------
-- Report: ore, performance, storico, planning
-- ---------------------------------------------------------------------------
do $$
declare
  ids uuid[]; a uuid; r record;
  v_emp uuid := pg_temp.vm('M_Emp', 'V1');
  v_emp2 uuid := pg_temp.vm('M_Emp2', 'V2');
begin
  perform tests.login('Ow');
  ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Ieri', 'date', (current_date - 1)::text, 'start_time', '18:00', 'end_time', '22:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', v_emp)))));
  select id into a from public.shift_assignments where shift_id = ids[1];
  perform public.record_attendance(a, '{"worked_hours": 3.5}'::jsonb);

  -- Due incarichi distinti possono essere svolti insieme, ma il tempo della
  -- persona non raddoppia: 14–22 + 18–23 = 9 ore. Il turno che inizia dopo si
  -- prende il tratto comune, quindi nello storico risultano 4 h + 5 h.
  ids := public.create_shifts(jsonb_build_array(
    jsonb_build_object(
      'venue_id', tests.id('V1'), 'title', 'Copertura', 'date', (current_date - 2)::text,
      'start_time', '14:00', 'end_time', '22:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', v_emp))),
    jsonb_build_object(
      'venue_id', tests.id('V1'), 'title', 'Supervisione', 'date', (current_date - 2)::text,
      'start_time', '18:00', 'end_time', '23:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', v_emp)))
  ));

  perform tests.login('Co2');  -- solo «ore», tutte le sedi
  select member_name, hours, shifts_count into r from public.get_hours_summary(current_date - 5, current_date + 1);
  perform tests.eq(r.hours, 12.5::numeric, 'ore manuali più unione dei turni sovrapposti');
  perform tests.eq(r.shifts_count, 3, 'i turni restano tre anche se le ore non raddoppiano');
  perform tests.eq((select worked_count from public.get_member_performance(tests.id('M_Emp'))), 3, 'performance visibile a chi ha «Ore»');
  perform tests.eq((select total_hours from public.get_member_performance(tests.id('M_Emp'))), 12.5::numeric, 'performance senza doppio conteggio');
  perform tests.eq((select count(*) from public.get_member_worked_shifts(tests.id('M_Emp'))), 3::bigint, 'ultimi turni');
  perform tests.eq((select sum(hours) from public.get_member_worked_shifts(tests.id('M_Emp'))), 12.5::numeric, 'dettaglio ore coerente col riepilogo');
  perform tests.eq((select hours from public.get_member_worked_shifts(tests.id('M_Emp')) where title = 'Copertura'), 4::numeric, 'il primo turno cede le ore comuni');
  perform tests.eq((select hours from public.get_member_worked_shifts(tests.id('M_Emp')) where title = 'Supervisione'), 5::numeric, 'il turno che inizia dopo conserva la sua durata');

  -- Gli annullati non sono lavoro: non contano neppure con una rettifica
  -- manuale e non sottraggono il tratto comune a un turno valido.
  perform tests.login('Ow');
  ids := public.create_shifts(jsonb_build_array(
    jsonb_build_object(
      'venue_id', tests.id('V2'), 'title', 'Valido Emp2', 'date', (current_date - 3)::text,
      'start_time', '14:00', 'end_time', '22:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', v_emp2))),
    jsonb_build_object(
      'venue_id', tests.id('V2'), 'title', 'Annullato sovrapposto', 'date', (current_date - 3)::text,
      'start_time', '18:00', 'end_time', '23:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', v_emp2))),
    jsonb_build_object(
      'venue_id', tests.id('V2'), 'title', 'Annullato rettificato', 'date', (current_date - 4)::text,
      'start_time', '10:00', 'end_time', '14:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', v_emp2))),
    jsonb_build_object(
      'venue_id', tests.id('V2'), 'title', 'Assente Emp2', 'date', (current_date - 5)::text,
      'start_time', '10:00', 'end_time', '12:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', v_emp2))),
    jsonb_build_object(
      'venue_id', tests.id('V2'), 'title', 'Rifiutato Emp2', 'date', (current_date - 6)::text,
      'start_time', '10:00', 'end_time', '12:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', v_emp2)))
  ));
  select id into a from public.shift_assignments where shift_id = ids[3];
  perform public.record_attendance(a, '{"worked_hours":4}'::jsonb);
  perform public.set_shift_status(ids[2], 'cancelled');
  perform public.set_shift_status(ids[3], 'cancelled');
  perform tests.logout();
  select id into a from public.shift_assignments where shift_id = ids[2];
  perform tests.eq(
    private.effective_assignment_hours(a, array[tests.id('V2')]),
    0::numeric, 'un annullato pianificato vale zero anche nel calcolo di base');
  select id into a from public.shift_assignments where shift_id = ids[3];
  perform tests.eq(
    private.effective_assignment_hours(a, array[tests.id('V2')]),
    0::numeric, 'un annullato con rettifica manuale vale comunque zero');
  perform tests.login('Ow');
  select id into a from public.shift_assignments where shift_id = ids[4];
  perform public.record_attendance(a, '{"status":"no_show"}'::jsonb);
  select id into a from public.shift_assignments where shift_id = ids[5];
  perform public.record_attendance(a, '{"status":"declined"}'::jsonb);
  perform public.set_venue_closed(tests.id('V2'), true);

  perform tests.login('Co2');
  select * into r from public.get_hours_summary(current_date - 10, current_date + 1)
   where member_id = tests.id('M_Emp2');
  perform tests.eq(r.shifts_count, 1, 'nel riepilogo resta soltanto il turno valido');
  perform tests.eq(r.hours, 8::numeric, 'l''annullato sovrapposto non sottrae ore al turno valido');
  perform tests.ok(r.venue_closed, 'lo storico mantiene anche una sede archiviata');
  perform tests.eq((select past_total from public.get_member_performance(tests.id('M_Emp2'))), 3, 'performance: annullati esclusi dal totale');
  perform tests.eq((select worked_count from public.get_member_performance(tests.id('M_Emp2'))), 1, 'performance: un solo turno lavorato');
  perform tests.eq((select no_show_count from public.get_member_performance(tests.id('M_Emp2'))), 1, 'performance: assenza conservata');
  perform tests.eq((select declined_count from public.get_member_performance(tests.id('M_Emp2'))), 1, 'performance: rifiuto conservato');
  perform tests.eq((select total_hours from public.get_member_performance(tests.id('M_Emp2'))), 8::numeric, 'performance: annullato rettificato a zero ore');
  perform tests.eq((select count(*) from public.get_member_worked_shifts(tests.id('M_Emp2'))), 1::bigint, 'dettaglio: annullati esclusi');
  perform tests.eq((select hours from public.get_member_worked_shifts(tests.id('M_Emp2'))), 8::numeric, 'dettaglio: durata valida intera');

  perform tests.login('Emp2');
  perform tests.eq((select total_count from public.get_my_work_history_totals()), 1, 'storico personale: annullati esclusi');
  perform tests.eq((select total_hours from public.get_my_work_history_totals()), 8::numeric, 'storico personale: solo ore valide');
  perform tests.login('Ow');
  perform public.set_venue_closed(tests.id('V2'), false);

  perform tests.login('Co');   -- ha «Turni» ma non «Ore»
  perform tests.eq((select count(*) from public.get_hours_summary(current_date - 5, current_date + 1)), 0::bigint, 'Co senza «Ore» non vede le ore');
  perform tests.eq((select past_total from public.get_member_performance(tests.id('M_Emp'))), 0, 'né la performance');
  perform tests.login('Emp2');
  perform tests.eq((select count(*) from public.get_hours_summary(current_date - 5, current_date + 1)), 0::bigint, 'Emp2 nemmeno');

  -- Il professionista vede il proprio storico e il planning dei colleghi.
  perform tests.login('Emp');
  perform tests.eq((select total_count from public.get_my_work_history_totals()), 3, 'storico: tre turni lavorati');
  perform tests.eq((select total_hours from public.get_my_work_history_totals()), 12.5::numeric, 'storico senza doppio conteggio');
  perform tests.eq((select total_hours from public.get_my_work_totals(current_date - 30, current_date)), 12.5::numeric, 'le ore del periodo');
  perform tests.eq((select total_count from public.get_my_work_totals(current_date + 1, current_date + 7)), 0, 'e niente fuori periodo');
  perform tests.eq((select count(*) from public.get_my_work_history_range(current_date - 30, current_date)), 3::bigint, 'lo storico del periodo');
  perform tests.eq((select sum(hours) from public.get_my_work_history_range(current_date - 30, current_date)), 12.5::numeric, 'righe dello storico coerenti col totale');
  perform tests.ok(exists (select 1 from public.get_staff_planning(current_date - 5, current_date + 30) where is_me and venue_id = tests.id('V1')),
    'il planning della sede mi include');
  perform tests.ok(not exists (select 1 from public.get_staff_planning(current_date - 5, current_date + 30) where venue_id = tests.id('V2')),
    'ma solo delle sedi in cui lavoro');
  perform tests.login('Ow');
  update public.venues set staff_sees_planning = false where id = tests.id('V1');
  perform tests.login('Emp');
  perform tests.eq((select count(*) from public.get_staff_planning(current_date - 5, current_date + 30) where venue_id = tests.id('V1')), 0::bigint,
    'la sede può nascondere il planning ai colleghi');
  perform tests.logout();
end $$;

-- ---------------------------------------------------------------------------
-- Report e assenze: perimetro esplicito dell'azienda corrente
-- ---------------------------------------------------------------------------
do $$
declare
  ids uuid[];
  r jsonb;
  v_emp_w2 uuid;
begin
  -- Emp è titolare di W2 e dipendente di W1. Mette sé stesso in organico su
  -- V3, poi invita Ow a gestire anche W2: Ow diventa il gestore di due aziende.
  perform tests.login('Emp');
  r := public.add_member(
    tests.id('W2'), '{}'::jsonb, 'none', '{}'::jsonb, 'all',
    jsonb_build_array(jsonb_build_object('venue_id', tests.id('V3'))), true
  );
  v_emp_w2 := (r -> 'venue_member_ids' ->> 0)::uuid;
  r := public.add_member(
    tests.id('W2'), '{"full_name":"Olivia","email":"ow@t.test"}'::jsonb,
    'collaborator', '{"hours":true,"staff":true}'::jsonb, 'all', '[]'::jsonb
  );
  perform tests.login('Ow');
  perform public.respond_to_invite((r ->> 'member_id')::uuid, true);

  -- Ore storiche in W2, separate da quelle già preparate in W1.
  perform tests.login('Emp');
  ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V3'), 'title', 'W2 storico', 'date', (current_date - 1)::text,
    'start_time', '10:00', 'end_time', '12:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', v_emp_w2))
  )));
  perform public.record_absence(
    tests.id('M_Emp_W2'), 'ferie', current_date + 60, current_date + 60
  );

  perform tests.login('Ow');
  perform tests.eq(
    (select count(*) from public.get_workspace_hours_summary(tests.id('W1'), current_date - 10, current_date + 1)
      where venue_id = tests.id('V3')),
    0::bigint, 'le ore W1 non contengono sedi di W2');
  perform tests.eq(
    (select sum(hours) from public.get_workspace_hours_summary(tests.id('W2'), current_date - 10, current_date + 1)),
    2::numeric, 'le ore W2 contengono soltanto il turno di W2');

  -- Le sedi archiviate restano nello storico dell'azienda corretta.
  perform public.set_venue_closed(tests.id('V1'), true);
  perform tests.ok(
    exists (select 1 from public.get_workspace_hours_summary(tests.id('W1'), current_date - 10, current_date + 1)
             where venue_id = tests.id('V1') and venue_closed),
    'W1 mantiene nello storico la propria sede archiviata');
  perform public.set_venue_closed(tests.id('V1'), false);

  perform tests.ok(
    not exists (select 1 from public.get_workspace_absence_summary(tests.id('W1'), current_date, current_date + 90)
                 where member_id = tests.id('M_Emp_W2')),
    'il riepilogo assenze W1 non contiene il membro W2 della stessa persona');
  perform tests.eq(
    (select ferie_days from public.get_workspace_absence_summary(tests.id('W2'), current_date, current_date + 90)
      where member_id = tests.id('M_Emp_W2')),
    1, 'il riepilogo assenze W2 contiene soltanto la propria assenza');

  -- Emp gestisce W2 ma lavora in W1: la vista personale continua a vedere
  -- entrambe le aziende, mentre il report manager di W2 non assorbe W1.
  perform tests.login('Emp');
  perform tests.eq(
    (select count(distinct m.workspace_id)
       from public.staff_absences a
       join public.workspace_members m on m.id = a.member_id
      where m.user_id = tests.id('Emp')),
    2::bigint, 'la persona conserva le proprie assenze di entrambe le aziende');
  perform tests.ok(
    not exists (select 1 from public.get_workspace_absence_summary(tests.id('W2'), current_date - 10, current_date + 90)
                 where member_id = tests.id('M_Emp')),
    'gestire W2 non attribuisce a W2 la propria assenza di W1');
  perform tests.eq(
    (select count(*) from public.get_workspace_hours_summary(tests.id('W1'), current_date - 10, current_date + 1)),
    0::bigint, 'un workspace non autorizzato non allarga le ore visibili');

  perform tests.login('Str');
  perform tests.eq(
    (select count(*) from public.get_workspace_hours_summary(tests.id('W1'), current_date - 10, current_date + 1)),
    0::bigint, 'un estraneo non ottiene ore indicando un workspace');
  perform tests.eq(
    (select count(*) from public.get_workspace_absence_summary(tests.id('W1'), current_date, current_date + 90)),
    0::bigint, 'un estraneo non ottiene assenze indicando un workspace');
  perform tests.logout();
end $$;

-- ---------------------------------------------------------------------------
-- Profilo professionale
-- ---------------------------------------------------------------------------
do $$
begin
  perform tests.anon();
  perform tests.raises('select count(*) from public.waiter_profiles', 'permission denied', 'il profilo professionale non è pubblico');
  perform tests.eq((select count(*) from public.waiter_public_cards), 0::bigint, 'nessuna carta senza un profilo professionale');

  perform tests.login('Emp');
  insert into public.waiter_profiles (id, primary_role, languages)
    values (tests.id('Emp'), 'Cameriere', array['Italiano', 'Inglese']);
  perform tests.raises(format('update public.waiter_profiles set rating_avg = 5 where id = %L', tests.id('Emp')),
    'permission denied', 'il rating non si scrive a mano');

  perform tests.anon();
  perform tests.eq((select count(*) from public.waiter_public_cards), 1::bigint, 'la carta pubblica c''è ora');
  insert into public.reviews (waiter_id, rating, comment) values (tests.id('Emp'), 5, 'bravo');
  perform tests.raises(format($f$insert into public.reviews (waiter_id, rating) values (%L, 5)$f$, tests.id('Emp2')),
    'row-level security', 'non si recensisce chi non ha un profilo');
  perform tests.logout();
  perform tests.eq((select rating_count from public.waiter_profiles where id = tests.id('Emp')), 1, 'il trigger aggiorna il rating');

  -- Le lingue le legge chi ha la persona in azienda: è il percorso su cui poggia
  -- la riga «Lingue» della scheda di organico, non una vetrina aperta a tutti.
  perform tests.login('Ow');
  perform tests.eq((select array_to_string(languages, ',') from public.waiter_profiles where id = tests.id('Emp')),
    'Italiano,Inglese', 'il titolare legge le lingue di chi ha in azienda');
  perform tests.login('Emp2');
  perform tests.eq((select count(*) from public.waiter_profiles where id = tests.id('Emp')), 0::bigint, 'un collega no');
  perform tests.logout();
end $$;

-- ---------------------------------------------------------------------------
-- Eliminazione account
-- ---------------------------------------------------------------------------
do $$
declare
  ids uuid[]; sh uuid;
  doc_path text := tests.id('M_Emp')::text || '/delete-account.pdf';
begin
  perform tests.login('Emp');
  perform tests.raises(
    'select * from public.account_file_cleanup',
    'permission denied', 'la coda cleanup è solo service role');
  insert into public.staff_documents (
    member_id, name, storage_path, mime_type, size_bytes
  ) values (
    tests.id('M_Emp'), 'Da eliminare', doc_path, 'application/pdf', 10
  );

  perform tests.login('Ow');
  perform tests.raises(format('select public.delete_account(%L)', tests.id('Emp')), 'permission denied', 'non è una RPC per gli utenti');
  ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Domani', 'date', (current_date + 2)::text, 'start_time', '18:00', 'end_time', '22:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', pg_temp.vm('M_Emp', 'V1'))))));
  sh := ids[1];
  perform tests.logout();

  -- Emp: professionista in W1, unico titolare di W2.
  perform public.delete_account(tests.id('Emp'));
  perform tests.ok(
    not exists (select 1 from public.staff_documents where storage_path = doc_path),
    'la riga documento viene eliminata');
  perform tests.eq(
    (select count(*) from public.account_file_cleanup
      where user_id = tests.id('Emp') and bucket_id = 'staff-documents'
        and object_name = doc_path),
    1::bigint, 'il path documento sopravvive nella coda service-only');
  perform public.delete_account(tests.id('Emp'));
  perform tests.eq(
    (select count(*) from public.account_file_cleanup
      where user_id = tests.id('Emp') and object_name = doc_path),
    1::bigint, 'il retry della RPC non duplica il cleanup');
  perform tests.ok((select deleted_at is not null from public.workspaces where id = tests.id('W2')), 'W2 (unico titolare) si chiude');
  perform tests.ok((select closed_at is not null from public.venues where id = tests.id('V3')), 'con le sue sedi');
  perform tests.ok((select user_id is null and status = 'left' from public.workspace_members where id = tests.id('M_Emp')),
    'la scheda in W1 resta al titolare, scollegata');
  perform tests.eq((select count(*) from public.shift_assignments where shift_id = sh), 0::bigint, 'i turni futuri sono liberati');
  perform tests.eq((select full_name from public.profiles where id = tests.id('Emp')), 'Utente eliminato', 'profilo anonimizzato');
  perform tests.ok(not exists (select 1 from public.workspaces where id = tests.id('W1') and deleted_at is not null), 'W1 non è toccata');

  -- Ow: unico titolare di W1: l'azienda si chiude, i turni futuri si annullano.
  perform public.delete_account(tests.id('Ow'));
  perform tests.ok((select deleted_at is not null from public.workspaces where id = tests.id('W1')), 'W1 si chiude');
  perform tests.eq((select count(*) from public.shifts s where s.venue_id in (tests.id('V1'), tests.id('V2'))
                     and s.status <> 'cancelled' and public.shift_ends_at(s.date, s.start_time, s.end_time) > public.local_now()),
                   0::bigint, 'nessun turno futuro attivo');
  perform tests.login('Emp2');
  perform tests.eq((select count(*) from public.venues), 0::bigint, 'Emp2 non vede più l''azienda chiusa');
  perform tests.logout();
end $$;

rollback;
select 'people: ok' as result;
