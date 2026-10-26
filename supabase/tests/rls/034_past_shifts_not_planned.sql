-- Il passato non si pianifica, si registra: nessuna strada di pianificazione
-- fa nascere un turno già finito, e mettere qualcuno su un turno finito è una
-- rettifica da chi ha Ore.
begin;

do $$
declare
  vm uuid;
  vm_ow uuid;
  d date := current_date - 3;
  past_shift uuid;
  ids uuid[];
  aid uuid;
begin
  select x.id into vm from public.venue_members x
   where x.member_id = tests.id('M_Emp') and x.venue_id = tests.id('V1');
  select x.id into vm_ow from public.venue_members x
   where x.member_id = tests.id('M_Ow') and x.venue_id = tests.id('V1');

  perform tests.login('Ow');
  perform tests.raises(format('select public.create_shifts(%L::jsonb)', jsonb_build_array(
      jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Sera', 'date', d::text,
        'start_time', '18:00', 'end_time', '23:00'))),
    'shift_finished', 'nemmeno il titolare pianifica un turno finito');
  perform tests.raises(format('select public.create_shifts(%L::jsonb)', jsonb_build_array(
      jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Sera',
        'dates', jsonb_build_array((current_date + 1)::text, d::text),
        'start_time', '18:00', 'end_time', '23:00'))),
    'shift_finished', 'tutto o niente: una data passata ferma anche le altre');

  -- Un turno futuro con una persona: spostarla in un giorno passato non fa
  -- nascere il gemello nel passato.
  ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Pranzo', 'date', (current_date + 2)::text,
    'start_time', '12:00', 'end_time', '15:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm)))));
  select a.id into aid from public.shift_assignments a where a.shift_id = ids[1];
  perform tests.raises(format('select public.move_assignment(%L, null, %L)', aid, d),
    'shift_finished', 'il gemello non nasce nel passato');

  -- Un turno finito, registrato da chi ha Ore.
  perform tests.login('Co2');
  past_shift := public.record_past_shift(tests.id('V1'), d, '18:00', '23:00', 0, 'Sera', null,
    jsonb_build_array(jsonb_build_object('venue_member_id', vm)));

  -- Chi ha solo Turni non ci aggiunge nessuno: farebbe contare delle ore.
  perform tests.login('Co');
  perform tests.raises(format('select public.assign(%L, %L)', past_shift, vm_ow),
    'finished_shift_locked', 'con solo Turni un turno finito non riceve persone');
  perform tests.raises(format('select public.move_assignment(%L, %L)', aid, past_shift),
    'finished_shift_locked', 'nemmeno spostandoci qualcuno');

  -- Il titolare (che ha Ore) sì: è la rettifica di chi c'era davvero.
  perform tests.login('Ow');
  perform tests.ok(public.assign(past_shift, vm_ow) is not null,
    'con Ore si aggiunge chi ha lavorato davvero');
end $$;

rollback;
select 'past shifts not planned: ok' as result;
