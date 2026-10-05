-- Identità delle notifiche: riferimenti certi, nessun confronto di nomi.
begin;
do $$
declare
  conv uuid;
  sh uuid;
  vm uuid;
  ids uuid[];
  ab uuid;
begin
  delete from public.notifications;
  perform tests.login('Emp');
  conv := public.open_conversation(p_workspace => tests.id('W1'));
  insert into public.messages(conversation_id, sender_id, content)
  values (conv, tests.id('Emp'), 'Foto della persona corretta');
  perform tests.logout();
  perform tests.eq((select person_id from public.notifications
    where user_id = tests.id('Ow') and type = 'new_message'), tests.id('M_Emp'),
    'un messaggio raffigura la controparte della conversazione');
  perform tests.eq(private.notification_person(tests.id('Ow'), 'new_message', conv, null),
    tests.id('M_Emp'), 'anche lo storico chat ha una persona certa');
  perform tests.eq(private.notification_person(tests.id('Emp'), 'new_message', conv, null),
    tests.id('M_Ow'), 'la direzione opposta raffigura il titolare');
  perform tests.eq(private.notification_person(tests.id('Ow'), 'absence_request', null, null),
    null::uuid, 'non si ricostruisce un attore storico senza riferimento');

  -- Un collaboratore con Organico riceve la richiesta senza il thread.
  update public.workspace_members set can_staff = true where id = tests.id('M_Co');
  perform tests.login('Emp');
  ab := public.request_absence(tests.id('W1'), 'ferie', current_date + 80, current_date + 81);
  perform tests.logout();
  perform tests.ok(exists(select 1 from public.notifications where user_id = tests.id('Co')
    and type = 'absence_request' and related_id is null and person_id = tests.id('M_Emp')),
    'la richiesta senza thread mantiene la persona corretta');
  perform tests.ok(exists(select 1 from public.notifications where user_id = tests.id('Ow')
    and type = 'absence_request' and person_id = tests.id('M_Emp')),
    'la richiesta al titolare usa la persona del thread');

  insert into public.notifications(user_id, type, title, body, related_id)
  values (tests.id('Ow'), 'staff_linked', 'Scheda collegata', 'Nome storico diverso', tests.id('M_Emp'));
  perform tests.eq((select person_id from public.notifications where type = 'staff_linked'),
    tests.id('M_Emp'), 'il collegamento account usa la scheda anche senza sessione');

  select id into vm from public.venue_members
   where member_id = tests.id('M_Emp') and venue_id = tests.id('V1');
  perform tests.login('Ow');
  ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Test avatar', 'date', (current_date + 70)::text,
    'start_time', '12:00', 'end_time', '16:00', 'require_confirmation', true,
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm)))));
  sh := ids[1];
  perform tests.logout();
  perform tests.ok(exists(select 1 from public.notifications where type = 'shift_assigned'
    and related_id = sh and person_id is null), 'un avviso di turno resta un evento generale');
  perform tests.eq(private.notification_person(tests.id('Ow'), 'shift_declined', sh, tests.id('Emp')),
    null::uuid, 'non si attribuisce un rifiuto a chi non ha rifiutato');
  perform tests.login('Emp');
  perform public.respond_assignment((select id from public.shift_assignments
    where shift_id = sh and venue_member_id = vm), 'declined');
  perform tests.logout();
  perform tests.ok(exists(select 1 from public.notifications where type = 'shift_declined'
    and related_id = sh and person_id = tests.id('M_Emp')),
    'il rifiuto del turno raffigura chi ha rifiutato');

  perform tests.login('Co');
  perform tests.ok(exists(select 1 from public.notifications where person_id = tests.id('M_Emp')),
    'il collaboratore legge la propria notifica con la persona');
  perform tests.raises(format('update public.notifications set person_id = %L', tests.id('M_Co')),
    'permission denied', 'il client non può cambiare la persona della notifica');
  perform tests.raises('select private.notification_person(null, ''new_message'', null, null)',
    'permission denied', 'il risolutore non è eseguibile dal client');
  perform tests.login('Str');
  perform tests.eq((select count(*) from public.notifications), 0::bigint,
    'le notifiche con avatar restano private per destinatario');
  perform tests.logout();
end $$;
rollback;
select 'notification person: ok' as result;
