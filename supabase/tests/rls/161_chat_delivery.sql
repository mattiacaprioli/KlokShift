-- Spunte della chat (2026-11-18): «ricevuto» è un segnalibro per persona sulla
-- conversazione, avanzato da `mark_chats_delivered` (una scrittura per
-- conversazione, solo se avanza) e da `mark_conversation_read`; «letto» resta
-- `messages.read_at`.
begin;

create function pg_temp.mine(p_conv uuid, p_user text) returns timestamptz language sql as $$
  select case when c.user_a = tests.id(p_user) then c.user_a_delivered_at else c.user_b_delivered_at end
    from public.conversations c where c.id = p_conv
$$;
grant execute on function pg_temp.mine(uuid, text) to public;

do $$
declare
  c1 uuid; last_at timestamptz; n integer;
begin
  perform tests.login('Ow');
  c1 := public.open_conversation(p_member => tests.id('M_Emp'));
  perform tests.login('Emp');
  insert into public.messages (conversation_id, sender_id, content) values (c1, tests.id('Emp'), 'ciao');
  insert into public.messages (conversation_id, sender_id, content) values (c1, tests.id('Emp'), 'ci sei?');
  perform tests.logout();
  select last_message_at into last_at from public.conversations where id = c1;

  -- Chi riceve porta il proprio segnalibro all'ultimo messaggio.
  perform tests.login('Ow');
  perform tests.eq(public.mark_chats_delivered(), 1, 'una conversazione avanzata');
  perform tests.logout();
  perform tests.eq(pg_temp.mine(c1, 'Ow'), last_at, 'il segnalibro di Ow è all''ultimo messaggio');
  perform tests.ok(pg_temp.mine(c1, 'Emp') is null, 'il lato di Emp non si tocca');

  -- Nessuna novità, nessuna scrittura.
  perform tests.login('Ow');
  perform tests.eq(public.mark_chats_delivered(), 0, 'nessuna scrittura senza novità');

  -- Non arretra (due dispositivi, chiamate fuori ordine).
  perform tests.logout();
  update public.conversations
     set user_a_delivered_at = case when user_a = tests.id('Ow') then last_at + interval '1 hour' else user_a_delivered_at end,
         user_b_delivered_at = case when user_b = tests.id('Ow') then last_at + interval '1 hour' else user_b_delivered_at end
   where id = c1;
  perform tests.login('Ow');
  perform tests.eq(public.mark_chats_delivered(), 0, 'un segnalibro più avanti non si abbassa');
  perform tests.logout();
  perform tests.eq(pg_temp.mine(c1, 'Ow'), last_at + interval '1 hour', 'segnalibro invariato');

  -- Solo le proprie conversazioni.
  perform tests.login('Emp2');
  perform tests.eq(public.mark_chats_delivered(), 0, 'Emp2 non ha conversazioni da segnare');
  perform tests.logout();
  perform tests.ok(pg_temp.mine(c1, 'Emp') is null, 'Emp2 non tocca la conversazione di Emp');

  -- Letto implica ricevuto.
  perform tests.login('Ow');
  insert into public.messages (conversation_id, sender_id, content) values (c1, tests.id('Ow'), 'sì');
  perform tests.login('Emp');
  perform public.mark_conversation_read(c1);
  perform tests.logout();
  select last_message_at into last_at from public.conversations where id = c1;
  perform tests.eq(pg_temp.mine(c1, 'Emp'), last_at, 'aprire il thread segna anche ricevuto');

  -- Il client non scrive il segnalibro da sé.
  perform tests.login('Emp');
  perform tests.raises(format($f$update public.conversations set user_a_delivered_at = now() where id = %L$f$, c1),
    'permission denied', 'nessun update diretto del segnalibro');
  perform tests.logout();

  -- In diretta: la conversazione è nella publication.
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    perform tests.eq((select count(*)::integer from pg_publication_tables
                       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'),
      1, 'conversations in realtime');
  end if;
end $$;

rollback;
select 'chat_delivery: ok' as result;
