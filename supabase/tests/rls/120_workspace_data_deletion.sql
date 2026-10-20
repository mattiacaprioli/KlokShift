-- M11: cancellazione dei dati aziendali a fine archivio. Solo il fondatore,
-- solo ad archivio scaduto, con il nome dell'azienda; tutto il resto resta.
begin;
insert into auth.sessions(id,user_id) values ('00000000-0000-4000-8000-000000000025',tests.id('Str'));
insert into auth.mfa_factors(id,user_id,factor_type,status) values
 ('00000000-0000-4000-8000-000000000026',tests.id('Str'),'totp','verified');
insert into private.platform_admins(user_id,reason) values(tests.id('Str'),'Fixture M11');

create function tests.dd_admin() returns void language plpgsql as $$
begin
  perform tests.login('Str');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', tests.id('Str'), 'role', 'authenticated',
    'session_id', '00000000-0000-4000-8000-000000000025', 'aal', 'aal2')::text, true);
end $$;
grant execute on function tests.dd_admin() to public;

do $$
declare
  w1 uuid := tests.id('W1'); v1 uuid := tests.id('V1'); w2 uuid := tests.id('W2');
  vm uuid; sh uuid; asg uuid; conv uuid; r jsonb; inv jsonb;
  op uuid := gen_random_uuid();
  logo text := 'https://x.supabase.co/storage/v1/object/public/avatars/' || tests.id('Ow') || '/logo.png';
begin
  -- Dati operativi di W1 (manutenzione fidata, come le fixture).
  perform tests.logout();
  select id into vm from public.venue_members where venue_id = v1 and member_id = tests.id('M_Emp');
  insert into public.shifts (venue_id, title, date, start_time, end_time)
  values (v1, 'Pranzo', current_date - 400, '10:00', '15:00') returning id into sh;
  insert into public.shift_assignments (shift_id, venue_id, venue_member_id)
  values (sh, v1, vm) returning id into asg;
  insert into public.shift_clock_records (assignment_id, shift_id, venue_id, venue_member_id, method, clock_in_at, clock_out_at)
  values (asg, sh, v1, vm, 'manual', (current_date - 400) + time '10:00', (current_date - 400) + time '15:00');
  insert into public.staff_absences (member_id, kind, start_date, end_date)
  values (tests.id('M_Emp'), 'ferie', current_date - 390, current_date - 388);
  insert into public.staff_documents (member_id, name, storage_path)
  values (tests.id('M_Emp'), 'Contratto', tests.id('M_Emp') || '/contratto.pdf');
  insert into public.conversations (workspace_id, user_a, user_b)
  values (w1, least(tests.id('Ow'), tests.id('Emp')), greatest(tests.id('Ow'), tests.id('Emp'))) returning id into conv;
  insert into public.messages (conversation_id, sender_id, content) values (conv, tests.id('Ow'), 'Ciao');
  insert into public.notifications (user_id, type, title, body, person_id)
  values (tests.id('Emp'), 'shift_assigned', 'Turno', 'Pranzo', tests.id('M_Emp'));
  update public.venues set logo_url = logo where id = v1;
  -- W2 (Emp è titolare lì): non va toccata.
  insert into public.staff_documents (member_id, name, storage_path)
  values (tests.id('M_Emp_W2'), 'Altro', tests.id('M_Emp_W2') || '/altro.pdf');

  -- W1 è ancora operativa (gratuità a vita): non si cancella.
  perform tests.dd_admin();
  perform tests.raises(format('select public.admin_delete_workspace_data(%L, %L, ''W1'', ''prova'')', w1, op),
    'admin_archive_not_expired', 'un''azienda operativa non si cancella');
  perform tests.eq((select count(*)::integer from jsonb_array_elements(public.admin_list_expired_archives() -> 'items') i
    where i ->> 'workspace_id' = w1::text), 0, 'non è fra gli archivi scaduti');
  perform tests.logout();

  -- La gratuità finisce 13 mesi fa: archivio scaduto.
  update public.workspace_access_periods set starts_at = now() - interval '3 years',
    revoked_at = now() - interval '13 months' where workspace_id = w1;
  perform tests.eq(private.workspace_access_at(w1, now()) ->> 'state', 'expired', 'archivio scaduto');

  perform tests.login('Ow');
  perform tests.raises(format('select public.admin_list_expired_archives()'), 'admin_not_allowed', 'il titolare non vede l''elenco');
  perform tests.raises(format('select public.admin_delete_workspace_data(%L, %L, ''W1'', ''prova'')', w1, op),
    'admin_not_allowed', 'il titolare non cancella');

  perform tests.dd_admin();
  r := public.admin_list_expired_archives();
  inv := (select i -> 'inventory' from jsonb_array_elements(r -> 'items') i where i ->> 'workspace_id' = w1::text);
  perform tests.eq((inv ->> 'venues')::integer, 2, 'inventario: due sedi');
  perform tests.eq((inv ->> 'shifts')::integer, 1, 'inventario: un turno');
  perform tests.eq((inv ->> 'documents')::integer, 1, 'inventario: un documento');
  perform tests.raises(format('select public.admin_delete_workspace_data(%L, %L, ''w1'', ''prova'')', w1, op),
    'admin_confirm_name_mismatch', 'serve il nome esatto');
  perform tests.raises(format('select public.admin_delete_workspace_data(%L, %L, ''W1'', '' '')', w1, op),
    'admin_reason_required', 'serve un motivo');

  r := public.admin_delete_workspace_data(w1, op, 'W1', 'Archivio scaduto, nessuna richiesta del cliente');
  perform tests.eq((r #>> '{deleted,members}')::integer, 5, 'cinque schede cancellate');
  perform tests.eq((r ->> 'files_pending')::integer, 2, 'documento e logo in coda per lo Storage');
  perform tests.eq(public.admin_delete_workspace_data(w1, op, 'W1', 'Archivio scaduto, nessuna richiesta del cliente'), r,
    'stessa operazione ripetuta: stesso esito, nessun effetto');
  perform tests.raises(format('select public.admin_delete_workspace_data(%L, %L, ''W1'', ''di nuovo'')', w1, gen_random_uuid()),
    'admin_data_already_deleted', 'non si cancella due volte');
  perform tests.logout();

  inv := private.workspace_data_inventory(w1);
  perform tests.eq(inv - 'files_pending', jsonb_build_object('venues', 0, 'shifts', 0, 'assignments', 0,
    'clock_records', 0, 'members', 0, 'absences', 0, 'documents', 0, 'conversations', 0, 'messages', 0,
    'notifications', 0), 'nessun dato operativo rimasto');
  perform tests.eq((select count(*)::integer from public.workspace_file_cleanup where workspace_id = w1
    and ((bucket_id = 'staff-documents' and object_name = tests.id('M_Emp') || '/contratto.pdf')
      or (bucket_id = 'avatars' and object_name = tests.id('Ow') || '/logo.png'))), 2, 'i percorsi giusti in coda');
  perform tests.eq((select data_deleted_at is not null and deleted_at is not null and name = 'W1'
    from public.workspaces where id = w1), true, 'resta la riga dell''azienda, segnata');
  perform tests.eq((select count(*)::integer from public.workspace_access_periods where workspace_id = w1), 1,
    'resta la storia commerciale');
  perform tests.eq((select action from private.admin_operations where operation_id = op), 'delete_data',
    'intervento registrato');
  perform tests.eq((select count(*)::integer from public.profiles where id in
    (tests.id('Ow'), tests.id('Emp'), tests.id('Emp2'), tests.id('Co'), tests.id('Co2'))), 5, 'gli account restano');
  perform tests.eq((select count(*)::integer from public.staff_documents where member_id = tests.id('M_Emp_W2')), 1,
    'l''altra azienda di Emp non è toccata');
  perform tests.eq((select count(*)::integer from public.venues where workspace_id = w2), 1, 'e le sue sedi restano');

  -- L'elenco la mostra finché i file sono in coda.
  perform tests.dd_admin();
  perform tests.eq((select i ->> 'data_deleted_at' is not null from jsonb_array_elements(public.admin_list_expired_archives() -> 'items') i
    where i ->> 'workspace_id' = w1::text), true, 'cancellata, con file ancora in coda');
  perform tests.logout();
end $$;

rollback;
select 'workspace data deletion: ok' as result;
