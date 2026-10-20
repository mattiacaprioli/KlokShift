-- M11: promemoria dell'archivio ai titolari (decisione del 20/10: email +
-- notifica nell'app).
--
-- Regola (docs/MONETIZATION.md §8): avviso all'inizio dell'archivio e a 30 e 7
-- giorni dal termine, con il link alla pagina autenticata di export. Ogni
-- mattina `private.run_archive_reminders` guarda le aziende in archivio e per
-- ogni titolare attivo registra il promemoria della fase in cui si trova
-- (inizio, 30 giorni, 7 giorni; se una fase è già passata si salta). La riga è
-- unica per azienda, titolare, fase e termine: un termine nuovo (l'azienda è
-- ripartita e poi tornata in archivio) riapre i promemoria.
--
-- La notifica nell'app nasce subito (`private.notify`, con la push del trigger
-- esistente) e resta neutra: niente prezzi o acquisti nell'app nativa. L'email
-- la spedisce la Edge Function `archive-reminders`, chiamata con pg_net e lo
-- stesso segreto Vault delle push; rilegge la coda e ritenta fino a 5 volte.

alter type public.notification_type add value if not exists 'archive_reminder';

create table public.archive_reminders (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  user_id         uuid not null,
  kind            text not null check (kind in ('started', '30_days', '7_days')),
  archive_until   timestamptz not null,
  -- Copie al momento della coda: l'email parla dell'azienda com'era.
  workspace_name  text not null,
  email           text not null,
  created_at      timestamptz not null default now(),
  emailed_at      timestamptz,
  email_attempts  integer not null default 0 check (email_attempts between 0 and 5),
  last_error_code text,
  unique (workspace_id, user_id, kind, archive_until)
);
create index archive_reminders_pending_idx on public.archive_reminders (created_at)
  where emailed_at is null;
alter table public.archive_reminders enable row level security;
revoke all on public.archive_reminders from public, anon, authenticated;
grant select, update on public.archive_reminders to service_role;

-- Una data come la legge un italiano.
create function private.rome_date(p_at timestamptz)
returns text language sql immutable set search_path = '' as $$
  select to_char(p_at at time zone 'Europe/Rome', 'DD/MM/YYYY');
$$;

create function private.queue_archive_reminders(p_at timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare
  w record;
  o record;
  a jsonb;
  v_until timestamptz;
  v_kind text;
  v_id uuid;
  v_title text;
  v_body text;
  v_count integer := 0;
begin
  for w in select id, name from public.workspaces
            where deleted_at is null and data_deleted_at is null loop
    a := private.workspace_access_at(w.id, p_at);
    continue when a ->> 'state' <> 'archive' or a ->> 'archive_until' is null;
    v_until := (a ->> 'archive_until')::timestamptz;
    v_kind := case when p_at >= v_until - interval '7 days' then '7_days'
                   when p_at >= v_until - interval '30 days' then '30_days'
                   else 'started' end;
    v_title := case v_kind when 'started' then 'Archivio di ' || w.name
                           else 'L''archivio di ' || w.name || ' sta per scadere' end;
    v_body := case v_kind
      when 'started' then 'L''operatività è terminata. Storico e report restano consultabili ed esportabili fino al '
        || private.rome_date(v_until) || '.'
      when '30_days' then 'Storico e report restano consultabili fino al ' || private.rome_date(v_until)
        || ', poi i dati dell''azienda vengono cancellati. Esporta quello che ti serve.'
      else 'Fra 7 giorni, dopo il ' || private.rome_date(v_until)
        || ', i dati dell''azienda vengono cancellati. Esporta quello che ti serve.' end;

    for o in
      select m.user_id, u.email from public.workspace_members m
        join auth.users u on u.id = m.user_id
       where m.workspace_id = w.id and m.authority = 'owner' and m.status = 'active'
         and u.deleted_at is null and u.email_confirmed_at is not null and u.email is not null
    loop
      -- Una fase già avvisata, o una successiva, non si ripete.
      continue when exists (select 1 from public.archive_reminders r
        where r.workspace_id = w.id and r.user_id = o.user_id and r.archive_until = v_until
          and (r.kind = v_kind or (v_kind = 'started' and r.kind in ('30_days', '7_days'))
               or (v_kind = '30_days' and r.kind = '7_days')));
      v_id := null;
      insert into public.archive_reminders (workspace_id, user_id, kind, archive_until, workspace_name, email)
      values (w.id, o.user_id, v_kind, v_until, w.name, o.email)
      on conflict (workspace_id, user_id, kind, archive_until) do nothing
      returning id into v_id;
      if v_id is not null then
        perform private.notify(o.user_id, 'archive_reminder', v_title, v_body, w.id);
        v_count := v_count + 1;
      end if;
    end loop;
  end loop;
  return v_count;
end;
$$;

-- Il lavoro del mattino: coda, notifiche e, se c'è da spedire, la chiamata
-- alla Edge Function delle email (asincrona, parte dopo il COMMIT).
create function private.run_archive_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
  v_secret text;
begin
  v_count := private.queue_archive_reminders(now());
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'push_hook_secret' limit 1;
  if v_secret is not null and exists (
       select 1 from public.archive_reminders where emailed_at is null and email_attempts < 5) then
    perform net.http_post(
      url     := 'https://rmlobxjlqlpixkvrzmfg.supabase.co/functions/v1/archive-reminders',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
      body    := '{}'::jsonb);
  end if;
  return v_count;
end;
$$;

revoke all on function private.rome_date(timestamptz), private.queue_archive_reminders(timestamptz),
  private.run_archive_reminders() from public, anon, authenticated;

-- Ogni giorno alle 7:00 UTC (8 o 9 in Italia). Se pg_cron non c'è (banco
-- locale) la migration non si ferma: il lavoro si programma dove esiste.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('archive-reminders', '0 7 * * *', 'select private.run_archive_reminders()');
exception when others then
  raise notice 'pg_cron non disponibile: promemoria non programmati (%).', sqlerrm;
end $$;
