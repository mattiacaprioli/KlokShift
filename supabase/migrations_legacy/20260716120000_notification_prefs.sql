-- Preferenze push per categoria (M7 polish). Modello opt-out: `{}` = tutto
-- attivo; una categoria è disattivata quando `notification_prefs->>cat = 'false'`.
-- Filtra SOLO la push OS: la notifica in-app (campanella/lista) viene comunque
-- creata. Il filtro sta nel trigger di dispatch (salta la net.http_post), così
-- l'Edge Function resta invariata.

alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

-- Mappa tipo notifica → categoria dello switch in Impostazioni (fonte unica).
create or replace function public.notification_category(t public.notification_type)
returns text
language sql
immutable
set search_path = ''
as $$
  select case t
    when 'new_message'    then 'messages'
    when 'staff_invite'   then 'staff'
    when 'staff_response' then 'staff'
    when 'staff_removed'  then 'staff'
    else 'shifts'  -- application_* + shift_* (candidature e turni)
  end;
$$;

-- Dispatch push con controllo preferenze.
create or replace function public.notify_push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_muted  boolean;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'push_hook_secret'
    limit 1;

  if v_secret is null then
    return new;
  end if;

  -- Preferenza utente: salta la push se la categoria è disattivata (l'in-app resta).
  select coalesce(
           (p.notification_prefs ->> public.notification_category(new.type)) = 'false',
           false
         )
    into v_muted
    from public.profiles p
    where p.id = new.user_id;

  if v_muted then
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

revoke execute on function public.notify_push_on_notification() from anon, authenticated, public;
