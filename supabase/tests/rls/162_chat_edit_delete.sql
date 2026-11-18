-- Modifica ed elimina messaggio (2026-11-18): solo i propri messaggi di testo,
-- modifica entro 15 minuti, eliminazione entro 48 ore, e il testo vecchio
-- cancellato davvero, anche dalla notifica in-app.
begin;

-- Sposta indietro l'invio di un messaggio (da superuser), con la notifica nata
-- da lui: nella realtà hanno lo stesso `created_at`.
create function pg_temp.age(p_msg uuid, p_age interval) returns void language sql as $$
  update public.notifications n set created_at = now() - p_age
    from public.messages m
   where m.id = p_msg and n.related_id = m.conversation_id and n.created_at = m.created_at;
  update public.messages set created_at = now() - p_age where id = p_msg;
$$;
grant execute on function pg_temp.age(uuid, interval) to public;

do $$
declare
  c1 uuid; m1 uuid; m2 uuid; card uuid; v_body text;
begin
  perform tests.login('Ow');
  c1 := public.open_conversation(p_member => tests.id('M_Emp'));
  perform tests.login('Emp');
  insert into public.messages (conversation_id, sender_id, content)
    values (c1, tests.id('Emp'), 'domani apro io alle 7') returning id into m1;
  perform tests.logout();
  perform tests.ok(exists (select 1 from public.notifications where user_id = tests.id('Ow') and type = 'new_message'
                            and related_id = c1 and body like '%: domani apro io alle 7'), 'la notifica nasce dal messaggio');

  -- Modifica.
  perform tests.login('Emp');
  perform public.edit_message(m1, '  domani apro io alle 8  ');
  perform tests.logout();
  perform tests.eq((select content from public.messages where id = m1), 'domani apro io alle 8', 'testo nuovo, normalizzato');
  perform tests.ok((select edited_at is not null from public.messages where id = m1), 'segnato come modificato');
  select n.body into v_body from public.notifications n
   where n.user_id = tests.id('Ow') and n.type = 'new_message' and n.related_id = c1;
  perform tests.ok(v_body like '%: domani apro io alle 8', 'la notifica prende il testo nuovo');
  perform tests.ok(v_body not like '%alle 7%', 'e non conserva il vecchio');

  -- Solo il proprio messaggio.
  perform tests.login('Ow');
  perform tests.raises(format('select public.edit_message(%L, %L)', m1, 'x'), 'not_allowed', 'non si modifica il messaggio altrui');
  perform tests.raises(format('select public.delete_message(%L)', m1), 'not_allowed', 'né si elimina');
  perform tests.login('Emp2');
  perform tests.raises(format('select public.edit_message(%L, %L)', m1, 'x'), 'not_allowed', 'da fuori conversazione nemmeno');

  -- Testo non valido.
  perform tests.login('Emp');
  perform tests.raises(format('select public.edit_message(%L, %L)', m1, ''), 'message_invalid', 'vuoto');
  perform tests.raises(format('select public.edit_message(%L, %L)', m1, '   '), 'message_invalid', 'solo spazi');
  perform tests.raises(format('select public.edit_message(%L, %L)', m1, repeat('a', 1001)), 'message_invalid', 'troppo lungo');

  -- Limite dei 15 minuti.
  perform tests.logout();
  perform pg_temp.age(m1, interval '14 minutes 59 seconds');
  perform tests.login('Emp');
  perform public.edit_message(m1, 'ancora in tempo');
  perform tests.logout();
  perform pg_temp.age(m1, interval '15 minutes 1 second');
  perform tests.login('Emp');
  perform tests.raises(format('select public.edit_message(%L, %L)', m1, 'tardi'), 'message_edit_expired', 'oltre i 15 minuti');

  -- Eliminazione (anche con la notifica già letta).
  perform tests.login('Ow');
  perform public.mark_conversation_read(c1);
  perform tests.login('Emp');
  perform public.delete_message(m1);
  perform tests.logout();
  perform tests.eq((select content from public.messages where id = m1), '', 'testo cancellato davvero');
  perform tests.ok((select deleted_at is not null from public.messages where id = m1), 'segnato come eliminato');
  perform tests.ok(exists (select 1 from public.notifications where user_id = tests.id('Ow') and type = 'new_message'
                            and related_id = c1 and body like '%: Messaggio eliminato'), 'la notifica dice che è stato eliminato');
  perform tests.ok(not exists (select 1 from public.notifications where body like '%ancora in tempo%' or body like '%alle 7%' or body like '%alle 8%'),
    'nessuna notifica conserva il vecchio testo');

  perform tests.login('Emp');
  perform public.delete_message(m1);
  perform tests.raises(format('select public.edit_message(%L, %L)', m1, 'di nuovo'), 'message_deleted', 'un eliminato non si modifica');

  -- Limite delle 48 ore.
  insert into public.messages (conversation_id, sender_id, content)
    values (c1, tests.id('Emp'), 'vecchio') returning id into m2;
  perform tests.logout();
  perform pg_temp.age(m2, interval '48 hours 1 second');
  perform tests.login('Emp');
  perform tests.raises(format('select public.delete_message(%L)', m2), 'message_delete_expired', 'oltre le 48 ore');
  perform tests.logout();
  perform pg_temp.age(m2, interval '47 hours 59 minutes');
  perform tests.login('Emp');
  perform public.delete_message(m2);

  -- Le card hanno il loro stato.
  perform tests.logout();
  insert into public.messages (conversation_id, sender_id, content, kind)
    values (c1, tests.id('Emp'), 'cambio turno', 'shift_change_request') returning id into card;
  perform tests.login('Emp');
  perform tests.raises(format('select public.edit_message(%L, %L)', card, 'x'), 'not_allowed', 'una card non si modifica');
  perform tests.raises(format('select public.delete_message(%L)', card), 'not_allowed', 'né si elimina');

  -- Un eliminato non può riavere testo, nemmeno se una modifica arriva dopo
  -- l'eliminazione (telefono e dashboard insieme): lo impedisce il vincolo.
  perform tests.logout();
  perform tests.raises(format($f$update public.messages set content = 'riapparso', edited_at = now() where id = %L$f$, m1),
    'messages_content_check', 'un eliminato resta senza testo');

  -- La notifica si riscrive solo se è nata da quel messaggio: un «ok» precedente
  -- (già letto, nato da un altro messaggio) non si tocca.
  perform tests.login('Ow');
  perform public.mark_conversation_read(c1);
  perform tests.login('Emp');
  insert into public.messages (conversation_id, sender_id, content) values (c1, tests.id('Emp'), 'ok') returning id into m2;
  perform tests.logout();
  update public.messages set created_at = created_at - interval '1 minute' where id = m2;
  update public.notifications set created_at = created_at - interval '1 minute'
   where user_id = tests.id('Ow') and type = 'new_message' and related_id = c1 and body like '%: ok';
  perform tests.login('Ow');
  perform public.mark_conversation_read(c1);
  perform tests.login('Emp');
  insert into public.messages (conversation_id, sender_id, content) values (c1, tests.id('Emp'), 'ok') returning id into m2;
  perform public.edit_message(m2, 'ok, arrivo');
  perform tests.logout();
  perform tests.eq((select count(*)::integer from public.notifications
                     where user_id = tests.id('Ow') and type = 'new_message' and related_id = c1 and body like '%: ok'),
    1, 'l''«ok» di prima resta com''era');
  perform tests.login('Emp');

  -- Nessuna scrittura diretta.
  perform tests.raises(format($f$update public.messages set content = 'x' where id = %L$f$, m2), 'permission denied', 'nessun update diretto');
  perform tests.raises(format($f$delete from public.messages where id = %L$f$, m2), 'permission denied', 'nessun delete diretto');
  perform tests.logout();
end $$;

rollback;
select 'chat_edit_delete: ok' as result;
