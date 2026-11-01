-- Turni in bozza (parte 4): perché l'anteprima non avvisa nessuno. Oltre a
-- `people` (chi riceve la notifica, tolto chi pubblica) dice quante persone
-- ci sono nei turni (`assignees`) e se fra loro c'è chi pubblica (`self`): la
-- finestra spiega il motivo giusto invece di tirare a indovinare.
begin;

do $$
declare
  w1 uuid := tests.id('W1');
  v1 uuid := tests.id('V1');
  d date := current_date + 30;
  vm_ow uuid;
  vm_emp uuid;
  vm_nina uuid;
  r jsonb;
begin
  select x.id into vm_ow from public.venue_members x
   where x.member_id = tests.id('M_Ow') and x.venue_id = v1;
  select x.id into vm_emp from public.venue_members x
   where x.member_id = tests.id('M_Emp') and x.venue_id = v1;

  perform tests.login('Ow');
  -- Nina è nel team ma non ha un account: nessuno da avvisare.
  r := public.add_member(w1, '{"full_name":"Nina"}'::jsonb, 'none', '{}'::jsonb, 'all',
         jsonb_build_array(jsonb_build_object('venue_id', v1)));
  select x.id into vm_nina from public.venue_members x
   where x.member_id = (r ->> 'member_id')::uuid and x.venue_id = v1;

  perform public.create_shifts(jsonb_build_array(
    jsonb_build_object('venue_id', v1, 'title', 'Vuoto', 'draft', true,
      'dates', jsonb_build_array(d::text), 'start_time', '09:00', 'end_time', '12:00'),
    jsonb_build_object('venue_id', v1, 'title', 'Solo io', 'draft', true,
      'dates', jsonb_build_array((d + 7)::text), 'start_time', '09:00', 'end_time', '12:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm_ow))),
    jsonb_build_object('venue_id', v1, 'title', 'Senza app', 'draft', true,
      'dates', jsonb_build_array((d + 14)::text), 'start_time', '09:00', 'end_time', '12:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm_nina))),
    jsonb_build_object('venue_id', v1, 'title', 'Io ed Emma', 'draft', true,
      'dates', jsonb_build_array((d + 21)::text), 'start_time', '09:00', 'end_time', '12:00',
      'staff', jsonb_build_array(
        jsonb_build_object('venue_member_id', vm_ow),
        jsonb_build_object('venue_member_id', vm_emp)))));

  r := public.get_publish_preview(array[v1], d, d + 6);
  perform tests.eq((r ->> 'shifts')::integer, 1, 'turno senza persone: uno');
  perform tests.eq((r ->> 'people')::integer, 0, 'senza persone nessuno da avvisare');
  perform tests.eq((r ->> 'assignees')::integer, 0, 'e nessuno nel turno');
  perform tests.eq((r ->> 'self')::boolean, false, 'nemmeno chi pubblica');

  r := public.get_publish_preview(array[v1], d + 7, d + 13);
  perform tests.eq((r ->> 'people')::integer, 0, 'solo chi pubblica: nessuno da avvisare');
  perform tests.eq((r ->> 'assignees')::integer, 1, 'ma una persona nel turno');
  perform tests.eq((r ->> 'self')::boolean, true, 'ed è chi pubblica');

  r := public.get_publish_preview(array[v1], d + 14, d + 20);
  perform tests.eq((r ->> 'people')::integer, 0, 'senza account: nessuno da avvisare');
  perform tests.eq((r ->> 'assignees')::integer, 1, 'una persona nel turno');
  perform tests.eq((r ->> 'self')::boolean, false, 'che non è chi pubblica');

  r := public.get_publish_preview(array[v1], d + 21, d + 27);
  perform tests.eq((r ->> 'people')::integer, 1, 'Emma da avvisare');
  perform tests.eq((r ->> 'assignees')::integer, 2, 'due persone nel turno');
  perform tests.eq((r ->> 'self')::boolean, true, 'una è chi pubblica');
  perform tests.logout();
end $$;

rollback;
