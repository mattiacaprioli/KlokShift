-- Superficie dello schema: cosa è scrivibile, cosa è eseguibile e da chi.
-- Se una migration futura apre qualcosa per sbaglio, questo test lo dice.
begin;

do $$
declare
  v text;
begin
  -- 1. Ogni tabella di public ha la RLS attiva.
  perform tests.eq(
    (select coalesce(string_agg(c.relname, ', ' order by c.relname), '') from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
    '', 'ogni tabella ha la RLS');

  -- 2. Nessuna policy di public interroga direttamente un'altra tabella (rischio
  --    ricorsione 42P17): solo helper di `private`.
  perform tests.eq(
    (select coalesce(string_agg(policyname, ', ' order by policyname), '') from pg_policies
      where schemaname = 'public'
        and (coalesce(qual, '') ~* '\mfrom\M' or coalesce(with_check, '') ~* '\mfrom\M')),
    '', 'le policy non hanno subquery dirette sulle tabelle');

  -- 3. anon non scrive e non legge niente.
  perform tests.eq(
    (select coalesce(string_agg(table_name || ':' || privilege_type, ', ' order by table_name, privilege_type), '')
       from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon'
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
    '', 'anon non ha scritture a livello di tabella');
  perform tests.eq(
    (select coalesce(string_agg(table_name, ', ' order by table_name), '')
       from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon' and privilege_type = 'SELECT'),
    '', 'anon non legge nessuna tabella');

  -- 4. Scritture di tabella per authenticated: solo dove la scrittura diretta è voluta.
  perform tests.eq(
    (select string_agg(table_name || ':' || privs, ' | ' order by table_name) from (
       select table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
         from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'authenticated'
          and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
        group by table_name) t),
    'notifications:DELETE | push_tokens:DELETE | staff_documents:DELETE | venue_roles:DELETE,INSERT,UPDATE',
    'scritture dirette per authenticated (livello tabella)');

  -- 5. Scritture per colonna: l'elenco esatto.
  perform tests.eq(
    (select string_agg(table_name || '.' || privilege_type || '(' || cols || ')', ' | ' order by table_name, privilege_type) from (
       select table_name, privilege_type, string_agg(column_name, ',' order by column_name) as cols
         from information_schema.column_privileges
        where table_schema = 'public' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE')
          and (table_name, privilege_type) not in (
            select table_name, privilege_type from information_schema.role_table_grants
             where table_schema = 'public' and grantee = 'authenticated')
        group by table_name, privilege_type) t),
    'messages.INSERT(content,conversation_id,sender_id) | notifications.UPDATE(read_at) | profiles.INSERT(full_name,id) | '
    'profiles.UPDATE(avatar_url,birth_day,birth_month,city,full_name,intro_seen,notification_prefs,onboarding_complete,phone) | '
    'staff_documents.INSERT(expires_at,member_id,mime_type,name,size_bytes,storage_path) | staff_documents.UPDATE(expires_at,name) | '
    'venues.UPDATE(address,city,cuisine_type,description,logo_url,name,staff_sees_planning) | '
    'waiter_profiles.INSERT(id,languages,primary_role) | '
    'waiter_profiles.UPDATE(languages,primary_role) | '
    'workspaces.UPDATE(staff_can_chat)',
    'scritture dirette per authenticated (livello colonna)');

  -- 6. Funzioni: anon non ne esegue nessuna, le riservate alla service role non sono di authenticated,
  --    e nessuna funzione-trigger è eseguibile dal client.
  perform tests.eq(
    (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'EXECUTE')),
    '', 'anon non esegue nessuna funzione');
  perform tests.eq(has_schema_privilege('anon', 'private', 'USAGE'), false, 'anon non usa lo schema private');
  perform tests.eq(
    (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('claim_invite_send', 'peek_invite', 'consume_invite', 'delete_account',
                         'grant_workspace_access', 'billing_apply_event', 'billing_prepare_checkout',
                         'billing_attach_checkout_transaction', 'billing_manage_context',
                         'billing_prepare_change', 'billing_prepare_lifecycle',
                         'billing_prepare_scheduled_change', 'billing_record_scheduled_change',
                         'billing_cancel_scheduled_change', 'billing_scheduled_claim',
                         'billing_scheduled_result')
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
    '', 'inviti, delete_account, concessioni e pagamenti sono solo della service role');
  perform tests.eq(
    (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prorettype = 'trigger'::regtype
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
    '', 'nessuna funzione-trigger è eseguibile dal client');
  -- Le RPC dell'area fondatore sono di authenticated, ma ognuna si apre con il
  -- controllo server del fondatore (allowlist, sessione viva, aal2): l'accesso
  -- globale non deriva mai dall'authority del cliente.
  perform tests.eq(
    (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'admin\_%'
        and p.prosrc not like '%perform private.require_platform_admin()%'),
    '', 'ogni RPC admin_* passa da private.require_platform_admin');
  perform tests.eq(
    (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('admin_list_billing_adjustments', 'admin_resolve_billing_adjustment',
                          'admin_list_scheduled_billing_changes', 'admin_resolve_scheduled_billing_change',
                          'admin_retry_scheduled_billing_change')
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
    5, 'pagamenti e cambi programmati da verificare: RPC admin presenti');
  -- Tutte le funzioni di public sono security definer con search_path fisso o pure/immutabili.
  perform tests.eq(
    (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prokind = 'f'
        and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))),
    '', 'ogni funzione ha il search_path fissato');

  -- 7. Le letture operative DEFINER aggirano la policy restrittiva di archivio:
  --    il confine commerciale deve stare nel loro corpo. Elenco esplicito: quelle
  --    di 20261005000500_commercial_archive_reads più le letture della timbratura
  --    senza turno (una ridefinizione partita da una versione vecchia l'aveva perso).
  perform tests.eq(
    (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = any (array[
          'get_absence_availability', 'get_absence_hour_credits', 'get_absence_summary',
          'get_chat_counterparts', 'get_chat_unread_count', 'get_hours_summary',
          'get_member_performance', 'get_member_worked_shifts', 'get_staff_planning',
          'get_workspace_absence_summary', 'get_workspace_contacts', 'get_workspace_hours_summary',
          'get_open_unplanned_clocks', 'get_my_unplanned_clock'])
        and p.prosrc not like '%commercial_readable_%'),
    '', 'le letture operative DEFINER mantengono il confine commerciale');
end $$;

rollback;
select 'surface: ok' as result;
