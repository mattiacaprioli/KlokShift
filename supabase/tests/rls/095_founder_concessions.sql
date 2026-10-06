begin;
insert into auth.sessions(id,user_id) values('00000000-0000-4000-8000-000000000095',tests.id('Str'));
insert into auth.mfa_factors(id,user_id,factor_type,status)
values('00000000-0000-4000-8000-000000000096',tests.id('Str'),'totp','verified');
insert into private.platform_admins(user_id,reason) values(tests.id('Str'),'Fixture M06a');
create function tests.founder_login() returns void language plpgsql as $$
begin
  perform tests.login('Str');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',tests.id('Str'),'role','authenticated',
    'session_id','00000000-0000-4000-8000-000000000095','aal','aal2')::text,true);
end $$;
grant execute on function tests.founder_login() to authenticated;

-- Azienda preesistente: nessuna prova/piano dedotti, nessuna conversione all'installazione.
delete from public.workspace_access_periods where workspace_id=tests.id('W2');
update public.workspace_commercial_state set migration_review_required=true where workspace_id=tests.id('W2');
select tests.login('Ow');
select tests.raises('select public.admin_get_workspace_control(tests.id(''W2''))','admin_not_allowed');
select tests.raises('select public.admin_apply_workspace_action(tests.id(''W2''),''add_note'',''nota'',gen_random_uuid(),repeat(''0'',32))','admin_not_allowed');
select tests.raises('select public.admin_set_account_classification(tests.id(''Ow''),''test'',''motivo'',gen_random_uuid(),repeat(''0'',32))','admin_not_allowed');
select tests.raises('select public.admin_list_operations(''workspace'',tests.id(''W2''))','admin_not_allowed');
select tests.founder_login();
select set_config('request.jwt.claims',jsonb_build_object('sub',tests.id('Str'),'role','authenticated',
 'session_id','00000000-0000-4000-8000-000000000095','aal','aal1')::text,true);
select tests.raises('select public.admin_apply_workspace_action(tests.id(''W2''),''add_note'',''nota'',gen_random_uuid(),repeat(''0'',32))','admin_mfa_required');
select tests.founder_login();
select tests.raises('select * from private.admin_operations','permission denied');

do $$
declare ws uuid:=tests.id('W2'); revision text; op uuid:=gen_random_uuid(); note_op uuid:=gen_random_uuid();
  label_op uuid:=gen_random_uuid(); result jsonb; retry jsonb; account_revision text; trial_at text;
begin
  revision:=public.admin_get_workspace_control(ws)->>'revision';
  perform tests.eq(public.admin_get_workspace_control(ws)#>>'{snapshot,access,state}','migration_pending','legacy prima della concessione');
  perform tests.raises(format('select public.admin_apply_workspace_action(%L,''grant_lifetime'','''',%L,%L,p_plan=>''team'',p_venue_limit=>1,p_document_limit_bytes=>2147483648)',ws,op,revision),'admin_reason_required');
  perform public.admin_apply_workspace_action(ws,'set_classification','Azienda di test scelta',label_op,revision,p_classification=>'test');
  perform tests.eq(public.admin_get_workspace_control(ws)#>>'{snapshot,access,state}','migration_pending','etichetta non concede operatività');
  perform tests.eq(public.admin_get_workspace_control(ws)#>>'{snapshot,access,plan}',null::text,'etichetta non inventa piano');
  perform tests.raises(format('select public.admin_apply_workspace_action(%L,''grant_lifetime'',''conferma vecchia'',%L,%L,p_plan=>''team'',p_venue_limit=>1,p_document_limit_bytes=>2147483648)',ws,op,revision),'admin_stale_revision');
  revision:=public.admin_get_workspace_control(ws)->>'revision';
  result:=public.admin_apply_workspace_action(ws,'grant_lifetime','Gratuità esplicita per azienda',op,revision,p_plan=>'base',p_venue_limit=>1,p_document_limit_bytes=>2147483648);
  retry:=public.admin_apply_workspace_action(ws,'grant_lifetime','Gratuità esplicita per azienda',op,revision,p_plan=>'base',p_venue_limit=>1,p_document_limit_bytes=>2147483648);
  perform tests.eq(result,retry,'retry con identica richiesta restituisce lo stesso esito');
  perform tests.eq(public.admin_get_workspace_control(ws)#>>'{snapshot,access,state}','operational','concessione attiva nello stesso snapshot');
  perform tests.eq(public.admin_get_workspace_control(ws)#>>'{snapshot,access,source}','complimentary_lifetime','diritto permanente aziendale');
  perform tests.eq(public.admin_get_workspace_control(ws)#>>'{snapshot,access,operational_until}',null::text,'nessuna scadenza fittizia');
  perform tests.eq(public.admin_get_workspace_control(ws)#>>'{snapshot,lifetime,document_limit_bytes}','2147483648','quota dichiarata verificabile');
  perform tests.eq(public.admin_get_workspace_control(tests.id('W1'))#>>'{snapshot,access,plan}','team','altra azienda non cambia');
  perform tests.eq((public.admin_list_operations('workspace',ws)->>'total')::int,2,'retry non duplica audit');
  perform tests.raises(format('select public.admin_apply_workspace_action(%L,''add_note'',''payload cambiato'',%L,%L)',ws,op,revision),'admin_operation_conflict');
  revision:=public.admin_get_workspace_control(ws)->>'revision';
  perform public.admin_apply_workspace_action(ws,'grant_lifetime','Estensione capacità gratuita',gen_random_uuid(),revision,p_plan=>'team',p_venue_limit=>3,p_document_limit_bytes=>4294967296);
  perform tests.eq(public.admin_get_workspace_control(ws)#>>'{snapshot,lifetime,venue_limit}','3','variazione capacità corrente');
  perform tests.eq((public.admin_get_workspace(ws)#>>'{periods,total}')::int,2,'periodi precedenti conservati');
  revision:=public.admin_get_workspace_control(ws)->>'revision';
  perform public.admin_apply_workspace_action(ws,'add_note','Nota senza modifica commerciale',note_op,revision);
  perform tests.eq(public.admin_get_workspace_control(ws)->>'revision',revision,'nota non cambia diritti/scadenze');
  account_revision:=public.admin_get_account_control(tests.id('Ow'))->>'revision';
  perform public.admin_set_account_classification(tests.id('Ow'),'test','Account di prova scelto',gen_random_uuid(),account_revision);
  perform tests.eq(public.admin_get_account_control(tests.id('Ow'))->>'classification','test','classificazione account esplicita');
  perform tests.eq(public.admin_get_workspace_control(ws)#>>'{snapshot,classification}','test','account non modifica azienda');
  perform tests.eq((public.admin_list_operations('workspace',ws,p_offset=>25)->>'total')::int,4,'pagina audit vuota conserva totale');
  perform tests.ok((public.admin_list_operations('workspace',ws)->'items') @>
    jsonb_build_array(jsonb_build_object('operation_id',note_op,'action','add_note')),'nota presente nel registro');
  perform tests.logout();
  perform tests.eq((select count(*) from public.workspace_access_periods where workspace_id=ws and kind='complimentary_lifetime' and revoked_at is null),1::bigint,'una capacità permanente corrente');
  perform tests.eq((select trial_started_at from public.workspace_commercial_state where workspace_id=ws),null::timestamptz,'nessuna prova inventata');
  perform tests.eq((select migration_review_required from public.workspace_commercial_state where workspace_id=ws),false,'migrazione risolta dalla sola concessione esplicita');
  perform tests.eq((select count(*) from private.admin_operations where operation_id=op),1::bigint,'operazione atomica unica');
  perform tests.founder_login();
end $$;

-- Capacità: anche il fondatore non può applicare una riduzione incompatibile.
do $$
declare ws uuid:=tests.id('W1'); revision text;
begin
  revision:=public.admin_get_workspace_control(ws)->>'revision';
  perform tests.raises(format('select public.admin_apply_workspace_action(%L,''grant_lifetime'',''Troppo piccola'',gen_random_uuid(),%L,p_plan=>''base'',p_venue_limit=>1,p_document_limit_bytes=>2147483648)',ws,revision),'workspace_venue_capacity');
  perform tests.logout();
  insert into storage.objects(bucket_id,name,metadata) values('staff-documents',tests.id('M_Emp')||'/m06.pdf','{"size":1024}');
  perform tests.founder_login();
  revision:=public.admin_get_workspace_control(ws)->>'revision';
  perform tests.raises(format('select public.admin_apply_workspace_action(%L,''grant_lifetime'',''Quota piccola'',gen_random_uuid(),%L,p_plan=>''team'',p_venue_limit=>2,p_document_limit_bytes=>1023)',ws,revision),'admin_document_capacity');
  perform tests.logout();
  update storage.objects set metadata='{}' where name=tests.id('M_Emp')||'/m06.pdf';
  perform tests.founder_login();
  revision:=public.admin_get_workspace_control(ws)->>'revision';
  perform tests.raises(format('select public.admin_apply_workspace_action(%L,''grant_lifetime'',''Dimensioni ignote'',gen_random_uuid(),%L,p_plan=>''team'',p_venue_limit=>2,p_document_limit_bytes=>2147483648)',ws,revision),'admin_document_usage_unknown');
  perform tests.logout();
  delete from storage.objects where name=tests.id('M_Emp')||'/m06.pdf';
  insert into public.workspace_access_periods(workspace_id,kind,plan,venue_limit,starts_at,ends_at,reason)
    values(ws,'transition','team',2,now()+interval '1 day',now()+interval '2 days','Periodo futuro fixture');
  perform tests.founder_login();
  revision:=public.admin_get_workspace_control(ws)->>'revision';
  perform tests.raises(format('select public.admin_apply_workspace_action(%L,''grant_lifetime'',''Conflitto futuro'',gen_random_uuid(),%L,p_plan=>''team'',p_venue_limit=>2,p_document_limit_bytes=>2147483648)',ws,revision),'admin_future_period_conflict');
  perform tests.logout();
  delete from public.workspace_access_periods where workspace_id=ws and kind='transition';
  update public.workspace_access_periods set revoked_at=now()-interval '1 hour',starts_at=now()-interval '2 days' where workspace_id=ws;
  perform tests.founder_login();
  revision:=public.admin_get_workspace_control(ws)->>'revision';
  perform public.admin_apply_workspace_action(ws,'add_note','Archivio da consultare',gen_random_uuid(),revision);
  perform tests.eq(public.admin_get_workspace_control(ws)->>'revision',revision,'nota non sposta archivio');
  perform tests.eq(public.admin_get_workspace_control(ws)#>>'{snapshot,access,state}','archive','archivio conservato');
  perform tests.logout();
  delete from public.workspace_commercial_state where workspace_id=ws;
  perform tests.founder_login();
  revision:=public.admin_get_workspace_control(ws)->>'revision';
  perform tests.raises(format('select public.admin_apply_workspace_action(%L,''grant_lifetime'',''Dato assente'',gen_random_uuid(),%L,p_plan=>''team'',p_venue_limit=>2,p_document_limit_bytes=>2147483648)',ws,revision),'workspace_access_unavailable');
end $$;
select tests.logout();
-- Ridurre a Base oltre 30 persone non revoca la capacità precedente.
select tests.login('Emp');
do $$
begin
  for i in 1..31 loop
    perform public.add_member(tests.id('W2'),jsonb_build_object('full_name','M06 persona '||i),'none','{}','all',
      jsonb_build_array(jsonb_build_object('venue_id',tests.id('V3'))));
  end loop;
end $$;
select tests.founder_login();
do $$
declare revision text:=public.admin_get_workspace_control(tests.id('W2'))->>'revision';
begin
  perform tests.raises(format('select public.admin_apply_workspace_action(%L,''grant_lifetime'',''Riduzione incompatibile'',gen_random_uuid(),%L,p_plan=>''base'',p_venue_limit=>3,p_document_limit_bytes=>2147483648)',tests.id('W2'),revision),'workspace_people_capacity');
  perform tests.eq(public.admin_get_workspace_control(tests.id('W2'))->>'revision',revision,'riduzione fallita atomica');
  perform tests.eq((public.admin_list_operations('workspace',tests.id('W2'))->>'total')::int,4,'fallimento non duplica audit');
end $$;
select tests.logout();
update private.platform_admins set revoked_at=now() where user_id=tests.id('Str');
select tests.founder_login();
select tests.raises('select public.admin_get_workspace_control(tests.id(''W2''))','admin_not_allowed');
select tests.raises('select public.admin_list_operations(''workspace'',tests.id(''W2''))','admin_not_allowed');
select tests.logout();
delete from public.workspaces where id=tests.id('W2');
select tests.eq((select count(*) from private.admin_operations where target_id=tests.id('W2')),4::bigint,'audit conservato dopo cancellazione del destinatario');
select tests.anon();
select tests.raises('select public.admin_get_workspace_control(tests.id(''W2''))','permission denied');
select tests.logout();
rollback;
