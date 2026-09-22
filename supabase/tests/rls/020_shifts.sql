-- Matrice B: turni, assegnazioni, presenze e ore, regole «su me stesso».
--   Ow  titolare, in organico V1        Co   collaboratore «turni», V1, in organico
--   Emp dipendente fisso in V1          Co2  collaboratore «ore», tutte le sedi
begin;

create function pg_temp.vm(p_member text, p_venue text) returns uuid language sql as $$
  select id from public.venue_members
   where member_id = tests.id(p_member) and venue_id = tests.id(p_venue)
$$;
-- Le funzioni temporanee non sono raggiungibili da `authenticated`: le si usa da postgres.
grant execute on function pg_temp.vm(text, text) to public;

do $$
declare
  ids uuid[];
  fut uuid; past uuid; a_emp uuid; a_co uuid; a_ow uuid;
  fut2 uuid; twin uuid; v2s uuid; a_new uuid;
  r public.shift_assignments;
  v_ow uuid; v_co uuid; v_emp uuid; v_emp2 uuid;
  v_n bigint;
begin
  v_ow := pg_temp.vm('M_Ow', 'V1'); v_co := pg_temp.vm('M_Co', 'V1');
  v_emp := pg_temp.vm('M_Emp', 'V1'); v_emp2 := pg_temp.vm('M_Emp2', 'V2');

  -- ---- creazione atomica, stato iniziale, posti, notifiche ----
  perform tests.login('Ow');
  ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Cena', 'dates', jsonb_build_array((current_date + 1)::text),
    'start_time', '18:00', 'end_time', '23:00',
    'staff', jsonb_build_array(
      jsonb_build_object('venue_member_id', v_emp), jsonb_build_object('venue_member_id', v_co),
      jsonb_build_object('venue_member_id', v_ow)))));
  fut := ids[1];
  perform tests.eq(array_length(ids, 1), 1, 'un turno creato');
  perform tests.eq((select count(*) from public.shift_assignments where shift_id = fut), 3::bigint, 'tre assegnati');
  perform tests.eq((select status::text from public.shift_assignments where shift_id = fut and venue_member_id = v_emp),
    'confirmed', 'il fisso nasce confermato d''ufficio');
  perform tests.ok((select confirmed_at is null from public.shift_assignments where shift_id = fut and venue_member_id = v_emp),
    '…senza una conferma di persona');
  perform tests.eq((select status::text from public.shift_assignments where shift_id = fut and venue_member_id = v_co),
    'assigned', 'a chiamata / collaboratore: da confermare');
  perform tests.eq((select status::text from public.shift_assignments where shift_id = fut and venue_member_id = v_ow),
    'confirmed', 'chi si mette in turno da sé conferma col gesto');
  perform tests.ok((select confirmed_at is not null from public.shift_assignments where shift_id = fut and venue_member_id = v_ow),
    '…e la conferma è registrata');
  perform tests.eq((select positions_total from public.shifts where id = fut), 3, 'posti totali = persone chiamate');
  perform tests.eq((select positions_filled from public.shifts where id = fut), 3, 'posti coperti');

  perform tests.logout();
  perform tests.eq((select count(*) from public.notifications where type = 'shift_assigned' and user_id = tests.id('Emp')), 1::bigint, 'Emp avvisato');
  perform tests.eq((select count(*) from public.notifications where type = 'shift_assigned' and user_id = tests.id('Ow')), 0::bigint, 'chi agisce non si avvisa da sé');

  -- ---- scritture dirette negate ----
  perform tests.login('Ow');
  perform tests.raises('insert into public.shifts (venue_id, title, date, start_time, end_time) values (' || quote_literal(tests.id('V1')) || ', ''x'', current_date, ''10:00'', ''11:00'')',
    'permission denied', 'i turni si creano con create_shifts');
  perform tests.raises('update public.shift_assignments set worked_hours = 9', 'permission denied', 'le ore non si scrivono a mano');
  perform tests.raises('delete from public.shift_assignments', 'permission denied', 'nessun DELETE diretto');

  -- ---- vincoli di organico ----
  perform tests.raises(format('select public.assign(%L, %L)', fut, v_emp2), 'not_in_roster', 'persona di un''altra sede');
  perform tests.raises(format('select public.assign(%L, %L)', fut, v_emp), 'already_assigned', 'doppia assegnazione');

  -- ---- confermare o rifiutare il proprio turno ----
  select id into a_emp from public.shift_assignments where shift_id = fut and venue_member_id = v_emp;
  select id into a_co  from public.shift_assignments where shift_id = fut and venue_member_id = v_co;
  select id into a_ow  from public.shift_assignments where shift_id = fut and venue_member_id = v_ow;
  perform tests.login('Emp2');
  perform tests.raises(format('select public.respond_assignment(%L, ''declined'')', a_emp), 'not_allowed', 'non si risponde per un altro');
  perform tests.login('Emp');
  perform tests.raises(format('select public.respond_assignment(%L, ''declined'')', a_co), 'not_allowed', 'nemmeno per un collega');
  perform tests.raises(format('select public.respond_assignment(%L, ''no_show'')', a_emp), 'invalid_status', 'solo conferma o rifiuto');
  r := public.respond_assignment(a_emp, 'declined');
  perform tests.eq(r.status::text, 'declined', 'Emp rifiuta');
  perform tests.eq((select positions_filled from public.shifts where id = fut), 2, 'il rifiuto libera un posto');
  perform tests.logout();
  perform tests.ok(exists (select 1 from public.notifications where type = 'shift_declined' and user_id = tests.id('Ow')), 'il titolare sa del rifiuto');
  perform tests.ok(exists (select 1 from public.notifications where type = 'shift_declined' and user_id = tests.id('Co')), 'chi ha «Turni» pure');
  perform tests.login('Emp');
  r := public.respond_assignment(a_emp, 'confirmed');
  perform tests.ok(r.confirmed_at is not null, 'la conferma di persona è registrata');

  -- ---- «su me stesso»: turno FUTURO ----
  perform tests.login('Co');
  perform public.unassign(a_co);      -- collaboratore si toglie da un turno futuro
  perform tests.eq((select count(*) from public.shift_assignments where id = a_co), 0::bigint, 'Co si toglie da un turno futuro');
  perform public.assign(fut, v_co);   -- e si rimette
  perform tests.eq((select status::text from public.shift_assignments where shift_id = fut and venue_member_id = v_co),
    'confirmed', 'rimettersi è una conferma');
  perform tests.raises(format('select public.assign(%L, %L)', fut, v_emp2), 'not_in_roster', 'Co non esce dal suo perimetro');

  -- ---- turno FINITO ----
  perform tests.login('Ow');
  ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Ieri', 'date', (current_date - 1)::text,
    'start_time', '18:00', 'end_time', '23:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', v_emp), jsonb_build_object('venue_member_id', v_co)))));
  past := ids[1];
  select id into a_emp from public.shift_assignments where shift_id = past and venue_member_id = v_emp;
  select id into a_co  from public.shift_assignments where shift_id = past and venue_member_id = v_co;

  -- Una patch deve descrivere una modifica reale e non deve diventare un
  -- percorso di lettura alternativo attraverso la SECURITY DEFINER.
  perform tests.login('Str');
  perform tests.raises(format('select public.record_attendance(%L, null)', a_emp), 'invalid_patch', 'patch SQL NULL negata');
  perform tests.raises(format('select public.record_attendance(%L, ''[]'')', a_emp), 'invalid_patch', 'patch non-oggetto negata');
  perform tests.raises(format('select public.record_attendance(%L, ''{}'')', a_emp), 'invalid_patch', 'patch vuota negata');
  perform tests.raises(format('select public.record_attendance(%L, ''{"ignored": true}'')', a_emp), 'invalid_patch', 'chiavi sconosciute negate');
  perform tests.raises(format('select public.record_attendance(%L, ''{"status": "confirmed"}'')', a_emp), 'not_allowed', 'patch valida fuori perimetro negata');

  perform tests.login('Co');
  perform tests.raises(format('select public.unassign(%L)', a_co), 'finished_shift_locked', 'Co non si toglie da un turno finito');
  perform tests.raises(format('select public.record_attendance(%L, ''{"worked_hours": 5}'')', a_co), 'not_allowed', 'Co non scrive le proprie ore');
  perform tests.raises(format('select public.record_attendance(%L, ''{"status": "no_show"}'')', a_co), 'not_allowed', 'né la propria presenza');
  -- Sugli altri: presenza sì (ha «Turni»), ore no (non ha «Ore»).
  r := public.record_attendance(a_emp, '{"status": "no_show"}'::jsonb);
  perform tests.eq(r.status::text, 'no_show', 'Co segna la presenza di Emp');
  perform tests.raises(format('select public.record_attendance(%L, ''{"worked_hours": 5}'')', a_emp), 'not_allowed', 'Co non ha «Ore»');
  perform tests.raises(format('select public.record_attendance(%L, ''{"status": "confirmed", "worked_hours": 5}'')', a_emp), 'not_allowed', 'la patch mista richiede «Turni» e «Ore»');
  perform tests.raises(format('select public.assign(%L, %L)', past, pg_temp.vm('M_Co', 'V1')), 'finished_shift_locked', 'né si mette su un turno finito (già presente: blocco prima del conflitto)');

  perform tests.login('Co2');  -- solo «ore»
  perform tests.raises(format('select public.record_attendance(%L, ''{"status": "confirmed"}'')', a_emp), 'not_allowed', 'Co2 non ha «Turni»');
  perform tests.raises(format('select public.record_attendance(%L, ''{"status": "confirmed", "worked_hours": 5}'')', a_emp), 'not_allowed', 'anche chi ha solo «Ore» non può inviare la patch mista');
  r := public.record_attendance(a_emp, '{"worked_hours": 4.5}'::jsonb);
  perform tests.eq(r.worked_hours, 4.5::numeric, 'Co2 scrive le ore');

  perform tests.login('Ow');
  r := public.record_attendance(a_co, '{"worked_hours": 5}'::jsonb);
  perform tests.eq(r.worked_hours, 5::numeric, 'il titolare scrive le ore di un collaboratore');
  perform public.assign(past, v_ow);    -- il titolare si mette su un turno finito: può
  perform tests.ok(exists (select 1 from public.shift_assignments where shift_id = past and venue_member_id = v_ow), 'Ow su un turno finito');
  select id into a_ow from public.shift_assignments where shift_id = past and venue_member_id = v_ow;
  r := public.record_attendance(a_ow, '{"worked_hours": 6}'::jsonb);
  perform tests.eq(r.worked_hours, 6::numeric, 'e si scrive le proprie ore');

  -- ---- correggere l'orario di un turno finito ----
  perform tests.login('Co');
  perform tests.raises(format($f$select public.update_shift(%L, '{"title":"Ieri","date":"%s","start_time":"17:00","end_time":"23:00"}')$f$, past, current_date - 1),
    'finished_shift_locked', 'Co non corregge un turno finito');
  perform tests.login('Ow');
  perform public.update_shift(past, format('{"title":"Ieri","date":"%s","start_time":"17:00","end_time":"23:00"}', current_date - 1)::jsonb);
  perform tests.eq((select start_time::text from public.shifts where id = past), '17:00:00', 'il titolare, in servizio, corregge');
  perform tests.raises(format('select public.delete_shift(%L)', past), 'finished_shift_locked', 'un turno finito con assegnati resta');

  -- ---- modifica orario di un turno futuro: conferma da capo, tranne chi modifica ----
  perform public.update_shift(fut, format('{"title":"Cena","date":"%s","start_time":"19:00","end_time":"23:30"}', current_date + 1)::jsonb);
  perform tests.eq((select status::text from public.shift_assignments where shift_id = fut and venue_member_id = v_emp), 'assigned', 'Emp deve riconfermare');
  perform tests.eq((select status::text from public.shift_assignments where shift_id = fut and venue_member_id = v_ow), 'confirmed', 'Ow, che ha modificato, no');
  perform tests.logout();
  perform tests.ok(exists (select 1 from public.notifications where type = 'shift_updated' and user_id = tests.id('Emp')), 'Emp avvisato della modifica');
  perform tests.ok(not exists (select 1 from public.notifications where type = 'shift_updated' and user_id = tests.id('Ow')), 'chi modifica non si avvisa');

  -- ---- spostare una PERSONA da un turno a un altro ----
  perform tests.login('Ow');
  select id into a_co  from public.shift_assignments where shift_id = fut and venue_member_id = v_co;
  select id into a_emp from public.shift_assignments where shift_id = fut and venue_member_id = v_emp;

  perform tests.raises(format('select public.move_assignment(%L)', a_co),
    'invalid_target', 'senza destinazione non si sposta niente');
  perform tests.raises(format('select public.move_assignment(%L, %L, %L)', a_co, fut, current_date + 2),
    'invalid_target', 'o un turno o una data, mai entrambi');

  -- Senza un turno dove metterla: nasce il gemello di quello di partenza.
  a_new := public.move_assignment(a_co, null, current_date + 2);
  select shift_id into twin from public.shift_assignments where id = a_new;
  perform tests.eq((select count(*) from public.shift_assignments where id = a_co), 0::bigint, 'Co esce dal turno di partenza');
  perform tests.eq((select date::text from public.shifts where id = twin), (current_date + 2)::text, 'il gemello è nel giorno d''arrivo');
  perform tests.eq((select title from public.shifts where id = twin), 'Cena', 'stesso titolo');
  perform tests.eq((select start_time::text from public.shifts where id = twin), '19:00:00', 'stessi orari');
  perform tests.eq((select venue_id from public.shifts where id = twin), tests.id('V1'), 'e stessa sede: un turno non cambia sede');
  perform tests.eq((select status::text from public.shift_assignments where id = a_new), 'assigned',
    'chi arriva non eredita la conferma che aveva sull''altro turno');
  perform tests.logout();
  perform tests.ok(exists (select 1 from public.notifications where type = 'shift_unassigned' and user_id = tests.id('Co')), 'Co sa di essere uscito');
  perform tests.ok(exists (select 1 from public.notifications where type = 'shift_assigned' and user_id = tests.id('Co')), 'e sa del turno nuovo');

  -- Con un turno già lì: ci si aggancia invece di crearne un altro.
  perform tests.login('Ow');
  ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Pranzo', 'date', (current_date + 3)::text,
    'start_time', '11:00', 'end_time', '15:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', v_emp)))));
  fut2 := ids[1];
  a_new := public.move_assignment(a_new, fut2);
  perform tests.eq((select shift_id from public.shift_assignments where id = a_new), fut2, 'Co passa sul turno che c''era già');
  perform tests.eq((select count(*) from public.shift_assignments where shift_id = twin), 0::bigint, 'il gemello resta senza nessuno');
  perform tests.eq(public.move_assignment(a_new, fut2), a_new, 'spostarla dov''è già non fa niente');

  perform tests.raises(format('select public.move_assignment(%L, %L)', a_emp, fut2),
    'already_assigned', 'Emp è già su quel turno');

  -- Un turno di una sede dove la persona non è in organico.
  ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V2'), 'title', 'Altrove', 'date', (current_date + 3)::text,
    'start_time', '18:00', 'end_time', '23:00')));
  v2s := ids[1];
  perform tests.raises(format('select public.move_assignment(%L, %L)', a_new, v2s),
    'not_in_roster', 'in V2 Co non lavora');

  -- Turno finito: vale la stessa regola di unassign.
  select id into a_co from public.shift_assignments where shift_id = past and venue_member_id = v_co;
  perform tests.login('Co');
  perform tests.raises(format('select public.move_assignment(%L, %L, %L)', a_co, null, current_date + 4),
    'finished_shift_locked', 'Co non si sposta via da un turno finito');

  perform tests.login('Ow');
  perform public.unassign(a_new);   -- il resto della suite conta su un fut2 vuoto di Co

  -- ---- visibilità ----
  perform tests.login('Emp');
  perform tests.ok((select count(*) from public.shift_assignments) >= 1, 'Emp vede le proprie assegnazioni');
  perform tests.ok(not exists (select 1 from public.shift_assignments a where a.venue_member_id <> v_emp), 'e solo quelle');
  perform tests.login('Emp2');
  perform tests.eq((select count(*) from public.shifts), 0::bigint, 'Emp2 (V2) non vede i turni di V1');
  perform tests.login('Co2');
  perform tests.eq((select count(*) from public.shifts), 0::bigint, 'chi ha solo «Ore» non legge i turni: usa le RPC delle ore');
  perform tests.login('Str');
  perform tests.eq((select count(*) from public.shifts), 0::bigint, 'Str non vede turni');

  -- ---- uscire da una sede libera i turni futuri e conserva lo storico ----
  perform tests.login('Ow');
  perform public.remove_member(tests.id('M_Emp'), tests.id('V1'));
  perform tests.eq((select count(*) from public.shift_assignments where shift_id = fut and venue_member_id = v_emp), 0::bigint, 'turno futuro liberato');
  perform tests.eq((select count(*) from public.shift_assignments where shift_id = past and venue_member_id = v_emp), 1::bigint, 'storico conservato');
  perform tests.logout();
  perform tests.ok(not exists (select 1 from public.notifications where type = 'shift_unassigned' and user_id = tests.id('Emp')),
    'nessuna raffica di «turno revocato» per una sola uscita');
  perform tests.ok(exists (select 1 from public.notifications where type = 'staff_removed' and user_id = tests.id('Emp')),
    'una sola notizia: «tolto dalla sede»');
end $$;

rollback;
select 'shifts: ok' as result;
