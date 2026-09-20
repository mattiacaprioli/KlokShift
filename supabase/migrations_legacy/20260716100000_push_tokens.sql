-- M7 push notifications — 1) Storage dei device token Expo.
-- Un device (token) appartiene a un solo utente per volta. La PK è il token così
-- che il riuso dello stesso device da parte di un altro account faccia un update
-- del proprietario invece di duplicare la riga.

create table if not exists public.push_tokens (
  token      text primary key,          -- ExponentPushToken[...]
  user_id    uuid not null references public.profiles(id) on delete cascade,
  platform   text,                      -- 'ios' | 'android'
  updated_at timestamptz not null default now()
);

create index if not exists push_tokens_user_idx on public.push_tokens(user_id);

alter table public.push_tokens enable row level security;

-- Own only: l'utente vede/gestisce solo i propri token. La Edge Function legge i
-- token via service_role (bypassa la RLS).
drop policy if exists "push_tokens: own only" on public.push_tokens;
create policy "push_tokens: own only" on public.push_tokens
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- RPC di registrazione: upsert sul token. SECURITY DEFINER perché il riuso device
-- (token già intestato a un altro utente) altrimenti sbatterebbe sulla RLS "own
-- only" in fase di UPDATE. Imposta sempre user_id = auth.uid().
create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;

  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (p_token, (select auth.uid()), p_platform, now())
  on conflict (token) do update
    set user_id    = excluded.user_id,
        platform   = excluded.platform,
        updated_at = now();
end;
$$;

revoke execute on function public.register_push_token(text, text) from anon, public;
grant execute on function public.register_push_token(text, text) to authenticated;
