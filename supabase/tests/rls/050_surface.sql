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
  --    ricorsione 42P17): solo helper di `private`. Unica eccezione: la funzione
  --    get_waiter_public_card nella policy di inserimento delle recensioni.
  perform tests.eq(
    (select coalesce(string_agg(policyname, ', ' order by policyname), '') from pg_policies
      where schemaname = 'public'
        and (coalesce(qual, '') ~* '\mfrom\M' or coalesce(with_check, '') ~* '\mfrom\M')),
    'reviews: public insert', 'le policy non hanno subquery dirette sulle tabelle');

  -- 3. anon non scrive niente e legge solo recensioni e carte pubbliche.
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
    'reviews, waiter_public_cards', 'anon legge solo recensioni e carte pubbliche');

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
    'reviews.INSERT(comment,rating,receipt_ref,reviewer_name,shift_id,tags,venue_id,waiter_id) | '
    'staff_documents.INSERT(expires_at,member_id,mime_type,name,size_bytes,storage_path) | staff_documents.UPDATE(expires_at,name) | '
    'venues.UPDATE(address,city,cuisine_type,description,logo_url,name,staff_sees_planning) | '
    'waiter_profiles.INSERT(id,languages,primary_role) | '
    'waiter_profiles.UPDATE(languages,primary_role)',
    'scritture dirette per authenticated (livello colonna)');

  -- 6. Funzioni: anon ne esegue tre, le riservate alla service role non sono di authenticated,
  --    e nessuna funzione-trigger è eseguibile dal client.
  perform tests.eq(
    (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'EXECUTE')),
    'get_rating_breakdown, get_waiter_public_card, waiter_public_cards_src', 'anon esegue solo le funzioni delle carte pubbliche');
  perform tests.eq(
    (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('claim_invite_send', 'peek_invite', 'consume_invite', 'delete_account')
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
    '', 'inviti e delete_account sono solo della service role');
  perform tests.eq(
    (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prorettype = 'trigger'::regtype
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
    '', 'nessuna funzione-trigger è eseguibile dal client');
  -- Tutte le funzioni di public sono security definer con search_path fisso o pure/immutabili.
  perform tests.eq(
    (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prokind = 'f'
        and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))),
    '', 'ogni funzione ha il search_path fissato');
end $$;

rollback;
select 'surface: ok' as result;
