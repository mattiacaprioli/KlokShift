-- Il banco SQL simula solo JWT/sessioni/fattori; il vero flusso TOTP si prova
-- su Supabase dev con la procedura manuale M05.
begin;
insert into auth.sessions(id,user_id) values ('00000000-0000-4000-8000-000000000005',tests.id('Str'));
insert into auth.sessions(id,user_id) values ('00000000-0000-4000-8000-000000000007',tests.id('Ow'));
insert into auth.mfa_factors(id,user_id,factor_type,status) values
 ('00000000-0000-4000-8000-000000000006',tests.id('Str'),'totp','verified');
insert into auth.mfa_factors(id,user_id,factor_type,status) values
 ('00000000-0000-4000-8000-000000000008',tests.id('Ow'),'totp','verified');
insert into private.platform_admins(user_id,reason) values(tests.id('Str'),'Fixture M05');
insert into private.admin_workspace_labels(workspace_id,classification,reason) values(tests.id('W1'),'test','Fixture esplicita');
insert into private.admin_account_labels(user_id,classification,reason) values(tests.id('Str'),'internal','Fondatore fixture');
insert into storage.objects(bucket_id,name,metadata) values
 ('staff-documents',tests.id('M_Emp')||'/known.pdf','{"size":1024}'),
 ('staff-documents',tests.id('M_Emp')||'/unknown.pdf','{}'),
 ('staff-documents',tests.id('M_Emp')||'/invalid.pdf','{"size":"unknown"}'),
 ('staff-documents','unattributed/file.pdf','{"size":100}');

select tests.login('Str');
select set_config('request.jwt.claims',jsonb_build_object('sub',tests.id('Str'),'role','authenticated',
 'session_id','00000000-0000-4000-8000-000000000005','aal','aal1')::text,true);
select tests.eq(public.get_platform_admin_access(),' {"eligible":true,"can_access":false}'::jsonb,'allowlist non basta senza MFA');
select tests.raises('select public.admin_get_overview()','admin_mfa_required');
select tests.raises('select public.admin_list_workspaces()','admin_mfa_required');
select tests.raises('select public.admin_get_workspace(tests.id(''W1''))','admin_mfa_required');
select tests.raises('select public.admin_list_accounts()','admin_mfa_required');
select tests.raises('select public.admin_get_account(tests.id(''Emp''))','admin_mfa_required');
select set_config('request.jwt.claims',jsonb_build_object('sub',tests.id('Str'),'role','authenticated',
 'session_id','00000000-0000-4000-8000-000000000005','aal','aal2')::text,true);
select tests.eq(public.get_platform_admin_access(),' {"eligible":true,"can_access":true}'::jsonb,'admin MFA senza azienda cliente');
select tests.eq((public.admin_get_overview()#>>'{accounts,total}')::int,6,'account Auth, non appartenenze');
select tests.eq((public.admin_get_overview()#>>'{documents,known_bytes}')::int,1124,'byte misurati da Storage');
select tests.eq((public.admin_get_overview()#>>'{documents,unknown_sizes}')::int,2,'dimensioni mancanti non stimate');
select tests.eq((public.admin_get_overview()#>>'{documents,unattributed_files}')::int,1,'file non attribuiti espliciti');
select tests.eq(public.admin_get_overview()->'finance','null'::jsonb,'finanza assente, non zero');
select tests.eq((public.admin_list_workspaces(p_query=>'ow@t.test')->>'total')::int,1,'ricerca per email gestore');
select tests.eq((public.admin_list_workspaces(p_query=>'%')->>'total')::int,0,'ricerca letterale, non wildcard');
select tests.eq((public.admin_list_workspaces(p_classification=>'test')->>'total')::int,1,'classificazione esplicita');
select tests.eq((public.admin_list_workspaces(p_classification=>'unclassified')->>'total')::int,1,'azienda senza etichetta resta non classificata');
select tests.eq(jsonb_array_length(public.admin_list_workspaces(p_limit=>1)->'items'),1,'pagina limitata');
select tests.eq((public.admin_list_workspaces(p_limit=>1,p_offset=>10)->>'total')::int,2,'pagina vuota conserva totale');
select tests.raises('select public.admin_list_accounts(p_limit=>51)','admin_invalid_filter');
select tests.raises('select public.admin_list_workspaces(p_state=>''invented'')','admin_invalid_filter');
select tests.raises('select public.admin_get_account(tests.id(''Emp''),-1)','admin_invalid_filter');
select tests.eq(public.admin_get_workspace(tests.id('W1'))#>>'{workspace,classification}','test','dettaglio azienda');
select tests.eq((public.admin_get_workspace(tests.id('W1'))#>>'{workspace,document_known_bytes}')::int,1024,'spazio per azienda');
select tests.ok(not (public.admin_get_workspace(tests.id('W1'))->'members'->'items'->0 ? 'hr'),'nessun dato HR');
select tests.eq((public.admin_get_account(tests.id('Emp'))#>>'{memberships,total}')::int,2,'account unico in due aziende');
select tests.eq((public.admin_get_account(tests.id('Co'))#>>'{memberships,items,0,managed_venues_total}')::int,1,'ambito collaboratore');
select tests.eq((public.admin_get_account(tests.id('Emp'))#>>'{memberships,items,1,managed_venues_total}')::int,1,'ambito titolare');
select tests.raises('select * from private.platform_admins','permission denied');
select tests.raises('select * from private.admin_workspace_rows','permission denied');
select tests.raises('select private.require_platform_admin()','permission denied');
select tests.eq((select count(*) from public.workspaces),0::bigint,'admin non allarga RLS clienti');
select tests.eq((select count(*) from storage.objects),0::bigint,'misura globale non concede lettura documenti');
select tests.eq(public.admin_list_accounts(p_limit=>1,p_offset=>0)->'items'->0->>'id',
 public.admin_list_accounts(p_limit=>1,p_offset=>0)->'items'->0->>'id','ordinamento stabile');
select tests.ok(public.admin_list_accounts(p_limit=>1,p_offset=>0)->'items'->0->>'id'<>
 public.admin_list_accounts(p_limit=>1,p_offset=>1)->'items'->0->>'id','pagine senza duplicazione');

select tests.logout();
-- Differenza tra Auth, profilo residuo e scheda aziendale manuale.
insert into public.profiles(id,full_name) values('00000000-0000-4000-8000-000000000009','Profilo residuo');
select tests.login('Ow');
select public.add_member(tests.id('W1'),'{"full_name":"Scheda manuale"}'::jsonb,'none','{}','all',
 jsonb_build_array(jsonb_build_object('venue_id',tests.id('V1'))));
select tests.logout();
update auth.users set email_confirmed_at=null where id=tests.id('Emp2');
update public.workspace_commercial_state set migration_review_required=true where workspace_id=tests.id('W2');
delete from public.workspace_access_periods where workspace_id=tests.id('W2');
select tests.login('Str');
select set_config('request.jwt.claims',jsonb_build_object('sub',tests.id('Str'),'role','authenticated',
 'session_id','00000000-0000-4000-8000-000000000005','aal','aal2')::text,true);
select tests.eq((public.admin_get_overview()#>>'{accounts,total}')::int,6,'profili residui e schede manuali non sono account');
select tests.eq((public.admin_list_accounts(p_status=>'unconfirmed')->>'total')::int,1,'conferma reale Auth');
select tests.eq(public.admin_get_workspace(tests.id('W2'))#>>'{workspace,state}','migration_pending','migrazione visibile senza piano inventato');
select tests.eq(public.admin_get_workspace(tests.id('W2'))#>'{workspace,access,plan}','null'::jsonb,'nessun piano dalla vecchia colonna');
select tests.logout();
select tests.login('Emp');
select public.create_shifts(jsonb_build_array(jsonb_build_object('venue_id',tests.id('V3'),'title','Legacy operativo','date',current_date+2,'start_time','10:00','end_time','12:00')));
select tests.logout();
-- La consultazione admin non ricalcola né prolunga un archivio esistente.
update public.workspace_access_periods set revoked_at=now()-interval '1 day',starts_at=now()-interval '2 days' where workspace_id=tests.id('W1');
create temp table admin_before as select private.workspace_access_at(tests.id('W1'),now())->>'archive_until' as archive_until;
grant select on admin_before to authenticated;
select tests.login('Str');
select set_config('request.jwt.claims',jsonb_build_object('sub',tests.id('Str'),'role','authenticated',
 'session_id','00000000-0000-4000-8000-000000000005','aal','aal2')::text,true);
select tests.eq(public.admin_get_workspace(tests.id('W1'))#>>'{workspace,state}','archive','archivio nel dettaglio');
select tests.eq(public.admin_get_workspace(tests.id('W1'))#>>'{workspace,access,archive_until}',(select archive_until from admin_before),'lettura non sposta archivio');

select tests.logout();
delete from public.workspace_commercial_state where workspace_id=tests.id('W2');
select tests.login('Str');
select set_config('request.jwt.claims',jsonb_build_object('sub',tests.id('Str'),'role','authenticated',
 'session_id','00000000-0000-4000-8000-000000000005','aal','aal2')::text,true);
select tests.eq(public.admin_get_workspace(tests.id('W2'))#>>'{workspace,state}','unavailable','dato mancante distinto dalla migrazione');
select tests.eq(public.admin_get_workspace(tests.id('W2'))#>'{workspace,access}','null'::jsonb,'dato mancante senza diritti inventati');
select tests.logout();
update auth.users set banned_until=now()+interval '1 day' where id=tests.id('Str');
select tests.login('Str');
select set_config('request.jwt.claims',jsonb_build_object('sub',tests.id('Str'),'role','authenticated',
 'session_id','00000000-0000-4000-8000-000000000005','aal','aal2')::text,true);
select tests.raises('select public.admin_get_overview()','admin_not_allowed','account bloccato');
select tests.logout();
update auth.users set banned_until=null where id=tests.id('Str');
update auth.users set email_confirmed_at=null where id=tests.id('Str');
select tests.login('Str');
select set_config('request.jwt.claims',jsonb_build_object('sub',tests.id('Str'),'role','authenticated',
 'session_id','00000000-0000-4000-8000-000000000005','aal','aal2')::text,true);
select tests.raises('select public.admin_get_overview()','admin_not_allowed','admin con email non confermata');
select tests.logout();
update auth.users set email_confirmed_at=now(),deleted_at=now() where id=tests.id('Str');
select tests.login('Str');
select set_config('request.jwt.claims',jsonb_build_object('sub',tests.id('Str'),'role','authenticated',
 'session_id','00000000-0000-4000-8000-000000000005','aal','aal2')::text,true);
select tests.raises('select public.admin_get_overview()','admin_not_allowed','admin eliminato');
select tests.logout();
update auth.users set deleted_at=null where id=tests.id('Str');
update auth.sessions set not_after=now()-interval '1 second' where user_id=tests.id('Str');
select tests.login('Str');
select set_config('request.jwt.claims',jsonb_build_object('sub',tests.id('Str'),'role','authenticated',
 'session_id','00000000-0000-4000-8000-000000000005','aal','aal2')::text,true);
select tests.raises('select public.admin_get_overview()','admin_not_allowed','sessione scaduta');
select tests.logout();
update auth.sessions set not_after=null where user_id=tests.id('Str');

select tests.logout();
update private.platform_admins set revoked_at=now() where user_id=tests.id('Str');
select tests.login('Str');
select set_config('request.jwt.claims',jsonb_build_object('sub',tests.id('Str'),'role','authenticated',
 'session_id','00000000-0000-4000-8000-000000000005','aal','aal2')::text,true);
select tests.raises('select public.admin_get_overview()','admin_not_allowed');
select tests.raises('select public.admin_list_workspaces()','admin_not_allowed');
select tests.raises('select public.admin_get_workspace(tests.id(''W1''))','admin_not_allowed');
select tests.raises('select public.admin_list_accounts()','admin_not_allowed');
select tests.raises('select public.admin_get_account(tests.id(''Emp''))','admin_not_allowed');
select tests.logout();
update private.platform_admins set revoked_at=null;
update auth.mfa_factors set status='unverified' where user_id=tests.id('Str');
select tests.login('Str');
select set_config('request.jwt.claims',jsonb_build_object('sub',tests.id('Str'),'role','authenticated',
 'session_id','00000000-0000-4000-8000-000000000005','aal','aal2')::text,true);
select tests.raises('select public.admin_get_overview()','admin_mfa_required','vecchio JWT aal2 dopo rimozione fattore');
select tests.logout();
update auth.mfa_factors set status='verified' where user_id=tests.id('Str');
delete from auth.sessions where user_id=tests.id('Str');
select tests.login('Str');
select set_config('request.jwt.claims',jsonb_build_object('sub',tests.id('Str'),'role','authenticated',
 'session_id','00000000-0000-4000-8000-000000000005','aal','aal2')::text,true);
select tests.raises('select public.admin_get_overview()','admin_not_allowed','JWT dopo logout');

select tests.logout();
select tests.login('Ow');
select set_config('request.jwt.claims',jsonb_build_object('sub',tests.id('Ow'),'role','authenticated',
 'session_id','00000000-0000-4000-8000-000000000007','aal','aal2','user_metadata',jsonb_build_object('platform_admin',true))::text,true);
select tests.raises('select public.admin_get_overview()','admin_not_allowed','owner cliente non admin');
select tests.login('Co');
select tests.raises('select public.admin_list_accounts()','admin_not_allowed','collaboratore non admin');
select tests.login('Emp');
select tests.raises('select public.admin_list_workspaces()','admin_not_allowed','professionista non admin');
select tests.anon();
select tests.raises('select public.get_platform_admin_access()','permission denied','anon escluso');
select tests.logout();
rollback;
