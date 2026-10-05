-- Chiamate reali come authenticated: capacità, archivio, eccezioni e isolamento.
begin;
do $$
declare
  ws uuid := tests.id('W1'); v1 uuid := tests.id('V1'); v2 uuid := tests.id('V2');
  r jsonb; mid uuid; aid uuid; sid uuid; future_sid uuid; future_aid uuid;
  pending uuid; pending_venue uuid; current_people integer; until_at timestamptz;
  archive_at timestamptz; clock_sid uuid; clock_aid uuid; clock_id uuid; conversation uuid;
begin
  perform tests.logout();
  delete from public.workspace_access_periods where workspace_id = ws;
  perform public.grant_workspace_access(ws,'complimentary_lifetime','base',3,now()-interval '1 day',null,'Fixture capacità Base');
  perform tests.login('Ow');
  current_people := (public.get_workspace_access(ws)#>>'{usage,people}')::integer;
  for i in current_people+1..30 loop
    r := public.add_member(ws,jsonb_build_object('full_name','Capacità '||i),'none','{}','all',
      jsonb_build_array(jsonb_build_object('venue_id',v1)));
    mid := (r->>'member_id')::uuid;
  end loop;
  perform tests.eq((public.get_workspace_access(ws)#>>'{usage,people}')::integer,30,'30 persone uniche');
  perform tests.raises(format('select public.add_member(%L,''{"full_name":"31"}'',''none'',''{}'',''all'',%L)',
    ws,jsonb_build_array(jsonb_build_object('venue_id',v2))), 'workspace_people_capacity','31esima persona rifiutata');
  -- La stessa persona in due sedi non occupa un nuovo posto.
  perform public.set_member_venue(mid,v2);
  perform tests.eq((public.get_workspace_access(ws)#>>'{usage,people}')::integer,30,'persona in due sedi una volta');
  perform public.remove_member(mid);
  perform tests.eq((public.get_workspace_access(ws)#>>'{usage,people}')::integer,29,'uscita libera posto');
  -- Ripristino tramite email, invito riservato, titolare in organico.
  r := public.add_member(ws,'{"full_name":"Posto riservato","email":"str@t.test"}','none','{}','all',
    jsonb_build_array(jsonb_build_object('venue_id',v1)));
  perform tests.login('Str');
  perform public.respond_to_invite((r->>'member_id')::uuid,true);
  perform tests.logout();
  perform tests.eq((private.workspace_access_at(ws,now())#>>'{usage,people}')::integer,30,'accettazione non conta due volte');
  -- Collaboratore limitato a V1: l'intera azienda consuma la capacità.
  update public.workspace_members set can_staff=true where id=tests.id('M_Co');
  perform tests.login('Co');
  perform tests.raises(format('select public.add_member(%L,''{"full_name":"31 scope"}'',''none'',''{}'',''all'',%L)',
    ws,jsonb_build_array(jsonb_build_object('venue_id',v1))), 'workspace_people_capacity','scope non restringe conteggio');
  perform tests.login('Ow');
  -- Terza sede e riapertura: comprende persone nascoste nella sede chiusa.
  pending_venue := public.create_venue(ws,'Sede stagionale');
  perform public.set_venue_closed(v2,true);
  r := public.add_member(ws,'{"full_name":"Solo sede stagionale"}','none','{}','all',
    jsonb_build_array(jsonb_build_object('venue_id',pending_venue)));
  perform tests.raises(format('select public.set_venue_closed(%L,false)',v2),
    'workspace_people_capacity','riapertura controlla persone ritornate');
  perform public.remove_member((r->>'member_id')::uuid);
  perform public.set_venue_closed(v2,false);
  perform tests.raises(format('select public.create_venue(%L,''Quarta'')',ws),
    'workspace_venue_capacity','quarta sede rifiutata');

  sid := (public.create_shifts(jsonb_build_array(jsonb_build_object('venue_id',v1,'title','Storico oltre 12 mesi',
    'date',current_date-800,'start_time','09:00','end_time','13:00'))))[1];
  select id into mid from public.venue_members where member_id=tests.id('M_Emp') and venue_id=v1;
  aid := public.assign(sid,mid);
  future_sid := (public.create_shifts(jsonb_build_array(jsonb_build_object('venue_id',v1,'title','Lavoro futuro',
    'date',current_date+1,'start_time','09:00','end_time','13:00'))))[1];
  future_aid := public.assign(future_sid,mid);
  clock_sid := (public.create_shifts(jsonb_build_array(jsonb_build_object('venue_id',v1,'title','Timbratura già aperta',
    'date',(public.local_now()-interval '2 hours')::date,'start_time',(public.local_now()-interval '2 hours')::time,
    'end_time',(public.local_now()+interval '1 hour')::time))))[1];
  clock_aid := public.assign(clock_sid,mid);
  perform public.set_member_clock_method(mid,'app');
  perform tests.logout();
  until_at := now()-interval '1 hour';
  -- Dati preesistenti alla fine operativa, preparati solo nella fixture.
  update public.shifts set created_at=until_at-interval '1 day' where id in (sid,future_sid,clock_sid);
  update public.shift_assignments set created_at=until_at-interval '1 day' where id in (aid,future_aid,clock_aid);
  insert into public.shift_clock_records(assignment_id,shift_id,venue_id,venue_member_id,method,clock_in_at,created_at)
  values(clock_aid,clock_sid,v1,mid,'app',until_at-interval '10 minutes',until_at-interval '10 minutes') returning id into clock_id;
  delete from public.workspace_access_periods where workspace_id=ws;
  perform public.grant_workspace_access(ws,'complimentary_temporary','base',3,until_at-interval '30 days',until_at,'Fixture archivio');
  perform tests.login('Ow');
  r := public.get_workspace_access(ws);
  perform tests.eq(r->>'state','archive','stato archivio senza cron');
  archive_at := (r->>'archive_until')::timestamptz;
  perform tests.raises(format('select public.update_shift(%L,''{"title":"Modificato"}'')',sid),
    'workspace_read_only','nemmeno turno passato genericamente modificabile');
  perform tests.raises(format('select public.assign(%L,%L)',future_sid,mid),'workspace_read_only','nuova assegnazione negata');
  perform tests.raises(format('select public.delete_shift(%L)',sid),'workspace_read_only','storico non cancellato dal normale form');
  perform tests.raises(format('select public.add_member(%L,''{"full_name":"Archivio"}'')',ws),'workspace_read_only','nuovo membro negato');
  perform tests.raises(format('update public.venues set name=''Operativo'' where id=%L',v1),'workspace_read_only','scrittura diretta sede negata');
  perform tests.raises(format('insert into public.venue_roles(venue_id,name) values(%L,''Nuova'')',v1),'workspace_read_only','ruoli diretti negati');
  perform tests.raises(format('insert into public.staff_documents(member_id,name,storage_path) values(%L,''Test'',%L)',
    tests.id('M_Emp'),tests.id('M_Emp')::text||'/archive.pdf'),'workspace_read_only','metadata upload negati');
  perform tests.raises(format('insert into storage.objects(bucket_id,name) values(''staff-documents'',%L)',
    tests.id('M_Emp')::text||'/archive.pdf'),'row-level security','Storage upload negato');
  conversation:=public.open_conversation(tests.id('M_Emp'));
  insert into public.messages(conversation_id,sender_id,content)
  values(conversation,auth.uid(),'Comunicazione in archivio M03b');
  perform tests.ok(exists(select 1 from public.messages where conversation_id=conversation
    and content='Comunicazione in archivio M03b'),'testo chat leggibile e scrivibile in archivio');
  perform tests.login('Emp');
  perform tests.raises(format('select public.clock_punch(%L,''in'')',future_aid),'workspace_read_only','nessuna nuova entrata in archivio');
  perform public.clock_punch(clock_aid,'out');
  perform tests.login('Ow');
  perform public.approve_clock_record(clock_aid);
  perform tests.raises(format('select public.correct_clock_record(%L,now()+interval ''1 day'',null,''Dopo scadenza'')',clock_id),
    'attendance_window_closed','rettifica non sposta il lavoro dopo la fine operativa');
  perform public.record_attendance(aid,'{"worked_hours":4}');
  perform tests.raises(format('select public.record_attendance(%L,''{"worked_hours":4}'')',future_aid),
    'attendance_window_closed','il futuro non diventa rettifica');
  perform tests.eq((public.get_workspace_access(ws)->>'archive_until')::timestamptz,archive_at,'rettifica non prolunga archivio');
  perform tests.ok(exists(select 1 from public.get_workspace_hours_summary(ws,current_date-801,current_date-799)),
    'export ore più vecchie di dodici mesi disponibile');
  perform public.set_venue_closed(v1,true);
  perform public.set_venue_closed(v2,true);
  perform public.set_venue_closed(pending_venue,true);
  perform tests.ok(exists(select 1 from public.get_workspace_hours_summary(ws,current_date-801,current_date-799)),
    'export anche con tutte le sedi chiuse');
  perform tests.eq((select count(*) from public.get_owner_past_shifts_page(array[v1,v2,pending_venue],100)),1::bigint,
    'storico sede chiusa conservato');
  perform public.set_member_access(tests.id('M_Co'),'collaborator','{}','selected',array[v1]);
  perform public.set_member_access(tests.id('M_Co'),'none');
  perform public.remove_member(tests.id('M_Co2'));
  perform tests.logout();
  update public.workspace_access_periods set starts_at=now()-interval '50 days',ends_at=now()-interval '8 days' where workspace_id=ws;
  perform tests.login('Ow');
  perform tests.raises(format('select public.record_attendance(%L,''{"worked_hours":3}'')',aid),
    'attendance_window_closed','dopo sette giorni nessuna rettifica');
  perform tests.ok(exists(select 1 from public.shifts where id=sid),'lettura continua dopo rettifiche');
  perform tests.logout();
  update public.workspace_access_periods set starts_at=now()-interval '15 months',ends_at=now()-interval '13 months' where workspace_id=ws;
  perform tests.login('Ow');
  perform tests.eq((select count(*) from public.shifts where id=sid),0::bigint,'lettura termina a fine archivio');
  perform tests.eq((select count(*) from public.get_workspace_hours_summary(ws,current_date-801,current_date-799)),0::bigint,
    'RPC definer non aggira fine archivio');
  perform tests.raises(format('select public.open_conversation(%L)',tests.id('M_Emp')),
    'workspace_read_only','nessun thread dopo fine archivio');
  perform tests.raises(format('insert into public.messages(conversation_id,sender_id,content) values(%L,%L,''Dopo archivio'')',
    conversation,auth.uid()),'row-level security','nessun testo dopo fine archivio');
  perform public.remove_member(tests.id('M_Emp2'));
  perform tests.login('Emp');
  perform tests.raises(format('select public.open_conversation(p_workspace=>%L)',ws),
    'workspace_read_only','anche ingresso chat per azienda termina');
  perform tests.eq(public.get_workspace_access(tests.id('W2'))->>'state','operational','altra azienda ancora operativa');
  -- Un'azienda in migration_pending continua senza prove/concessioni inventate.
  perform tests.login('Ow');
  pending := public.create_workspace('Compatibilità migrazione');
  perform tests.logout();
  update public.workspace_commercial_state set migration_review_required=true where workspace_id=pending;
  perform tests.login('Ow');
  pending_venue := public.create_venue(pending,'Prima legacy');
  perform public.create_venue(pending,'Seconda legacy');
  perform public.add_member(pending,'{"full_name":"Legacy"}','none','{}','all',
    jsonb_build_array(jsonb_build_object('venue_id',pending_venue)));
  perform public.create_shifts(jsonb_build_array(jsonb_build_object('venue_id',pending_venue,'title','Legacy',
    'date',current_date+1,'start_time','09:00','end_time','13:00')));
  perform tests.eq(public.get_workspace_access(pending)->>'state','migration_pending','compatibilità esplicita, stato invariato');
  perform tests.ok(public.get_workspace_access(pending)->>'plan' is null,'nessun piano inventato');
  perform tests.raises(format('select public.start_workspace_trial(%L)',pending),'commercial_migration_required','legacy non riceve prova');
  perform tests.logout();
  perform tests.eq((select count(*) from public.workspace_access_periods where workspace_id=pending),0::bigint,'nessun periodo legacy inventato');
  delete from public.workspace_commercial_state where workspace_id=pending;
  perform tests.login('Ow');
  perform tests.raises(format('select public.get_workspace_access(%L)',pending),
    'workspace_access_unavailable','lettura senza stato commerciale non inventa setup o diritti');
  perform tests.raises(format('select public.add_member(%L,''{"full_name":"Dato mancante"}'')',pending),
    'workspace_access_unavailable','dato mancante non equivale a migration_pending');
  perform tests.logout();
end $$;
rollback;
select 'commercial enforcement: ok' as result;
