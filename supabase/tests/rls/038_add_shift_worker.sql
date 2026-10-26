-- Il sostituto a turno finito: chi ha Ore aggiunge chi ha lavorato davvero,
-- presente e con le ore del turno, senza notifiche.
begin;

do $$
declare
  vm uuid;
  vm_ow uuid;
  d date := current_date - 3;
  ids uuid[];
  future_ids uuid[];
  asg public.shift_assignments;
  a_ow uuid;
begin
  select x.id into vm from public.venue_members x
   where x.member_id = tests.id('M_Emp') and x.venue_id = tests.id('V1');
  select x.id into vm_ow from public.venue_members x
   where x.member_id = tests.id('M_Ow') and x.venue_id = tests.id('V1');

  -- Era segnato il titolare; è venuta Emma.
  perform tests.login('Ow');
  ids := tests.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Sera', 'date', d::text,
    'start_time', '18:00', 'end_time', '23:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm_ow)))));
  future_ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Domani', 'date', (current_date + 1)::text,
    'start_time', '18:00', 'end_time', '23:00')));
  select a.id into a_ow from public.shift_assignments a where a.shift_id = ids[1];

  perform tests.login('Co');
  perform tests.raises(format('select public.add_shift_worker(%L, %L)', ids[1], vm),
    'not_allowed', 'con solo Turni non si aggiungono ore');

  perform tests.login('Co2');
  perform tests.raises(format('select public.add_shift_worker(%L, %L)', future_ids[1], vm),
    'shift_not_finished', 'prima della fine si pianifica');
  perform tests.raises(format('select public.add_shift_worker(%L, %L)', ids[1], vm_ow),
    'already_assigned', 'chi è già sul turno si segna presente o assente');

  asg := public.add_shift_worker(ids[1], vm);
  perform tests.eq(asg.status::text, 'confirmed', 'risulta presente');
  perform tests.eq(asg.hours_source, 'manual_auto', 'con le ore del turno');
  perform tests.ok(asg.worked_hours is null, 'senza ore scritte a mano');
  perform tests.eq((select sum(approved_hours) from public.get_workspace_hours_summary(
      tests.id('W1'), d, d + 1) where member_id = tests.id('M_Emp')),
    5::numeric, 'e le ore contano subito');
  perform tests.logout();
  perform tests.eq((select count(*) from public.notifications
                     where related_id = ids[1] and user_id = tests.id('Emp')),
    0::bigint, 'nessuna notifica di turno assegnato');

  -- Aveva rifiutato ed è venuta lo stesso: torna presente sulla sua riga.
  update public.shift_assignments set status = 'declined', confirmed_at = null where id = asg.id;
  perform tests.login('Co2');
  asg := public.add_shift_worker(ids[1], vm);
  perform tests.eq(asg.status::text, 'confirmed', 'il rifiuto lascia posto alla presenza');
  -- Letto da postgres: «Ore» senza «Turni» non legge le assegnazioni da REST.
  perform tests.logout();
  perform tests.eq((select count(*) from public.shift_assignments
                     where shift_id = ids[1] and venue_member_id = vm), 1::bigint,
    'sulla stessa riga');
end $$;

rollback;
select 'add shift worker: ok' as result;
