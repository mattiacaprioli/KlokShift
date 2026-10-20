-- M11: export completo. Titolare o collaboratore con Organico e Ore su tutte le
-- sedi; documenti solo con il loro permesso; in archivio sì, dopo la scadenza no.
begin;

do $$
declare
  w1 uuid := tests.id('W1'); v1 uuid := tests.id('V1');
  vm uuid; sh uuid; asg uuid; ab uuid; r jsonb;
begin
  perform tests.logout();
  select id into vm from public.venue_members where venue_id = v1 and member_id = tests.id('M_Emp');
  insert into public.shifts (venue_id, title, date, start_time, end_time, break_minutes)
  values (v1, 'Pranzo', current_date - 10, '10:00', '15:00', 30) returning id into sh;
  insert into public.shift_assignments (shift_id, venue_id, venue_member_id, worked_hours, hours_source)
  values (sh, v1, vm, 4.5, 'clock') returning id into asg;
  insert into public.shift_clock_records (assignment_id, shift_id, venue_id, venue_member_id, method, clock_in_at, clock_out_at)
  values (asg, sh, v1, vm, 'manual', (current_date - 10) + time '10:00', (current_date - 10) + time '15:00');
  insert into public.staff_absences (member_id, kind, start_date, end_date, status)
  values (tests.id('M_Emp'), 'ferie', current_date - 5, current_date - 4, 'approved') returning id into ab;
  insert into public.absence_hour_credits (absence_id, date, minutes) values (ab, current_date - 5, 480), (ab, current_date - 4, 480);
  insert into public.staff_documents (member_id, name, storage_path)
  values (tests.id('M_Emp'), 'Contratto', tests.id('M_Emp') || '/contratto.pdf');

  -- Titolare: tutto, documenti compresi.
  perform tests.login('Ow');
  r := public.export_workspace_data(w1);
  perform tests.eq(r #>> '{workspace,name}', 'W1', 'il titolare esporta la sua azienda');
  perform tests.eq(jsonb_array_length(r -> 'venues'), 2, 'due sedi');
  perform tests.eq(jsonb_array_length(r -> 'people'), 5, 'cinque schede');
  perform tests.eq((select count(*)::integer from jsonb_array_elements(r -> 'shifts') x where x ->> 'title' = 'Pranzo'), 1, 'il turno');
  perform tests.eq((select (x ->> 'worked_hours')::numeric from jsonb_array_elements(r -> 'attendance') x where x ->> 'person' = 'Emma')::numeric, 4.5::numeric,
    'la presenza con le ore approvate');
  perform tests.eq((select x ->> 'clock_in_at' is not null from jsonb_array_elements(r -> 'attendance') x where x ->> 'person' = 'Emma'), true,
    'e la timbratura');
  perform tests.eq((select (x ->> 'recognized_minutes')::integer from jsonb_array_elements(r -> 'absences') x), 960,
    'le ore riconosciute dell''assenza');
  perform tests.eq(r ->> 'documents_included', 'true', 'documenti inclusi');
  perform tests.eq((select x ->> 'storage_path' from jsonb_array_elements(r -> 'documents') x), tests.id('M_Emp') || '/contratto.pdf',
    'con il percorso del file');
  perform tests.eq(r ? 'messages' or r ? 'conversations', false, 'niente chat');

  -- Collaboratori: Co ha solo «Turni» su una sede, Co2 «Ore» su tutte ma non «Organico».
  perform tests.login('Co');
  perform tests.raises(format('select public.export_workspace_data(%L)', w1), 'export_not_allowed', 'serve Organico e Ore su tutte le sedi');
  perform tests.login('Co2');
  perform tests.raises(format('select public.export_workspace_data(%L)', w1), 'export_not_allowed', 'Ore da sola non basta');
  perform tests.logout();
  update public.workspace_members set can_staff = true where id = tests.id('M_Co2');
  perform tests.login('Co2');
  r := public.export_workspace_data(w1);
  perform tests.eq(jsonb_array_length(r -> 'people'), 5, 'con Organico e Ore su tutte le sedi esporta');
  perform tests.eq(r -> 'documents', 'null'::jsonb, 'ma senza Documenti niente documenti');
  perform tests.login('Emp');
  perform tests.raises(format('select public.export_workspace_data(%L)', w1), 'export_not_allowed', 'il dipendente no');
  perform tests.login('Str');
  perform tests.raises(format('select public.export_workspace_data(%L)', w1), 'export_not_allowed', 'un estraneo no');

  -- In archivio sì, dopo la scadenza no.
  perform tests.logout();
  update public.workspace_access_periods set starts_at = now() - interval '2 years',
    revoked_at = now() - interval '1 day' where workspace_id = w1;
  perform tests.login('Ow');
  perform tests.eq(public.export_workspace_data(w1) #>> '{workspace,name}', 'W1', 'in archivio si esporta');
  perform tests.logout();
  update public.workspace_access_periods set revoked_at = now() - interval '13 months' where workspace_id = w1;
  perform tests.login('Ow');
  perform tests.raises(format('select public.export_workspace_data(%L)', w1), 'workspace_not_readable', 'archivio scaduto: niente');
  perform tests.logout();
end $$;

rollback;
select 'workspace full export: ok' as result;
