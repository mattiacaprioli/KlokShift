-- Baseline — 5/N: notifiche in-app e push.
--
-- Invariato rispetto al modello precedente salvo due cose: `private.notify` è
-- l'unico punto da cui RPC e trigger creano una notifica (e salta chi ha agito),
-- e la categoria non nomina più le candidature del marketplace.

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       public.notification_type not null,
  title      text not null,
  body       text not null,
  related_id uuid,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;

create table public.push_tokens (
  token      text primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  platform   text,
  updated_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;

-- Le notifiche le crea il server. Il client le legge, le segna lette e le
-- cancella; non le inventa.
create policy "notifications: own read" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "notifications: own mark read" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications: own delete" on public.notifications
  for delete to authenticated using (user_id = (select auth.uid()));
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy "push_tokens: own read" on public.push_tokens
  for select to authenticated using (user_id = (select auth.uid()));
create policy "push_tokens: own delete" on public.push_tokens
  for delete to authenticated using (user_id = (select auth.uid()));
grant select, delete on public.push_tokens to authenticated;

-- Upsert del device token. security definer: un device già intestato a un altro
-- account passerebbe altrimenti dalla RLS «own only» in fase di UPDATE.
create function public.register_push_token(p_token text, p_platform text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (p_token, (select auth.uid()), p_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;
grant execute on function public.register_push_token(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Categoria per le preferenze push (fonte unica: switch in Impostazioni)
-- ---------------------------------------------------------------------------
create function public.notification_category(t public.notification_type)
returns text language sql immutable set search_path = '' as $$
  select case t
    when 'new_message'      then 'messages'
    when 'staff_invite'     then 'staff'
    when 'staff_response'   then 'staff'
    when 'staff_removed'    then 'staff'
    when 'staff_linked'     then 'staff'
    when 'team_linked'      then 'staff'
    when 'team_joined'      then 'staff'
    when 'team_removed'     then 'staff'
    when 'absence_request'  then 'staff'
    when 'absence_response' then 'staff'
    when 'absence_sick'     then 'staff'
    else 'shifts'
  end;
$$;
grant execute on function public.notification_category(public.notification_type) to authenticated;

-- ---------------------------------------------------------------------------
-- Dispatch push: un solo trigger su notifications, quindi nessun altro trigger
-- deve sapere che esiste. Async via pg_net (parte dopo il COMMIT). Il secret sta
-- in Vault: finché non c'è, il trigger resta inerte. Il filtro delle preferenze
-- salta la push e lascia la notifica in-app.
-- ---------------------------------------------------------------------------
create function public.notify_push_on_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_secret text;
  v_muted  boolean;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'push_hook_secret' limit 1;
  if v_secret is null then
    return new;
  end if;

  select coalesce((p.notification_prefs ->> public.notification_category(new.type)) = 'false', false)
    into v_muted from public.profiles p where p.id = new.user_id;
  if v_muted then
    return new;
  end if;

  perform net.http_post(
    url     := 'https://rmlobxjlqlpixkvrzmfg.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body    := jsonb_build_object(
      'notification_id', new.id, 'user_id', new.user_id, 'type', new.type,
      'title', new.title, 'body', new.body, 'related_id', new.related_id
    )
  );
  return new;
end;
$$;
create trigger notifications_push after insert on public.notifications
  for each row execute function public.notify_push_on_notification();

-- ---------------------------------------------------------------------------
-- L'unico modo di creare una notifica dal server.
-- ---------------------------------------------------------------------------
-- Salta chi ha agito: nessuno riceve l'avviso di un gesto che ha appena fatto
-- lui. Era una regola ripetuta a mano in ogni trigger, e dimenticata in
-- `notify_on_shift_change` fino al 19/09.
create function private.notify(
  p_user uuid, p_type public.notification_type, p_title text, p_body text, p_related uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null or p_user is not distinct from (select auth.uid()) then
    return;
  end if;
  insert into public.notifications (user_id, type, title, body, related_id)
  values (p_user, p_type, p_title, p_body, p_related);
end;
$$;

-- Come notify(), a tutti gli account che gestiscono la sede con quel permesso.
create function private.notify_managers(
  p_venue uuid, p_perm text, p_type public.notification_type, p_title text, p_body text,
  p_related uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  for v_user in select distinct private.managers_of(p_venue, p_perm) loop
    perform private.notify(v_user, p_type, p_title, p_body, p_related);
  end loop;
end;
$$;

grant execute on function
  private.notify(uuid, public.notification_type, text, text, uuid),
  private.notify_managers(uuid, text, public.notification_type, text, text, uuid)
to authenticated;
