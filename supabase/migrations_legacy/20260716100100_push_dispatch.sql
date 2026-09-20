-- M7 push notifications — 2) Dispatch: ad ogni notifica creata invia una push OS.
-- Un unico trigger AFTER INSERT su public.notifications copre TUTTI i tipi di
-- notifica (candidature, chat, turni, staff) senza toccare i 7 trigger esistenti,
-- incluse le fan-out in loop (shift_cancelled/updated) e la dedupe della chat.
--
-- Il DB chiama la Edge Function `push` via pg_net (async, inviata solo dopo il
-- COMMIT → non blocca l'INSERT e non parte per transazioni rollbackate).
-- L'auth è un secret condiviso conservato in Vault (header x-push-secret): finché
-- il secret non è impostato il trigger resta inerte (nessuna push, nessun errore).

create extension if not exists pg_net;

create or replace function public.notify_push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'push_hook_secret'
    limit 1;

  -- Non configurato (secret assente): non tentare la chiamata HTTP.
  if v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url     := 'https://rmlobxjlqlpixkvrzmfg.supabase.co/functions/v1/push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', v_secret
    ),
    body    := jsonb_build_object(
      'notification_id', new.id,
      'user_id',         new.user_id,
      'type',            new.type,
      'title',           new.title,
      'body',            new.body,
      'related_id',      new.related_id
    )
  );

  return new;
end;
$$;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push
  after insert on public.notifications
  for each row execute function public.notify_push_on_notification();

-- Funzione di trigger: non va esposta come RPC SECURITY DEFINER.
revoke execute on function public.notify_push_on_notification() from anon, authenticated, public;
