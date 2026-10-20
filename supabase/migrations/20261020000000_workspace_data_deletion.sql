-- M11: cancellazione dei dati aziendali a fine archivio, avviata dal fondatore.
--
-- Decisioni del 19-20/10 (plans/MONETIZATION-AND-FOUNDER-DASHBOARD.md, M11):
--   - la cancellazione parte solo per un'azienda con l'archivio scaduto
--     (`workspace_access_at` = `expired`) e senza abbonamento aperto; la avvia il
--     fondatore dall'area amministrativa scrivendo il nome dell'azienda;
--   - si cancellano i dati operativi: sedi, ruoli, modelli, turni,
--     assegnazioni, timbrature, assenze, schede delle persone (con dati HR,
--     inviti e documenti), chat e notifiche legate all'azienda, file dei
--     documenti e loghi delle sedi. Anche lo storico dei professionisti in
--     quell'azienda sparisce: hanno avuto i 12 mesi, come l'azienda;
--   - resta il registro commerciale: la riga dell'azienda (nome, date,
--     `data_deleted_at`), abbonamenti, acquisti, avvisi Paddle, rimborsi,
--     periodi di accesso, classificazione e interventi del fondatore. Restano
--     gli account delle persone e le loro altre aziende.
-- I file non si cancellano da SQL: finiscono in una coda che la Edge Function
-- `workspace-file-cleanup` svuota con l'API Storage, ritentando gli errori.
-- I backup del database contengono ancora i dati fino alla loro scadenza.

alter table public.workspaces add column data_deleted_at timestamptz;

-- 1. Coda dei file, come account_file_cleanup: service-only, RLS senza policy.
create table public.workspace_file_cleanup (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  bucket_id       text not null check (bucket_id in ('avatars', 'staff-documents')),
  object_name     text not null check (btrim(object_name) <> ''),
  attempts        integer not null default 0 check (attempts >= 0),
  last_error_code text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, bucket_id, object_name)
);
create index workspace_file_cleanup_created_idx on public.workspace_file_cleanup (created_at, id);
alter table public.workspace_file_cleanup enable row level security;
create trigger workspace_file_cleanup_updated_at
  before update on public.workspace_file_cleanup
  for each row execute function public.update_updated_at();
revoke all on public.workspace_file_cleanup from public, anon, authenticated;
grant select, update, delete on public.workspace_file_cleanup to service_role;

-- 2. Il registro degli interventi accetta la cancellazione dei dati.
alter table private.admin_operations drop constraint admin_operations_action_check;
alter table private.admin_operations add constraint admin_operations_action_check
  check (action in ('grant_lifetime', 'set_classification', 'add_note', 'delete_data'));

-- 3. La manutenzione della cancellazione passa dalle guardie commerciali.
--    Copia di private.guard_commercial_direct_write con il solo flag in più;
--    il flag lo imposta soltanto admin_delete_workspace_data (set_config non è
--    raggiungibile dal client).
create or replace function private.guard_commercial_direct_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ws uuid;
begin
  -- Manutenzione fidata (fixture, pulizia account): nessun nuovo grant client.
  if (select auth.uid()) is null and current_setting('role') in ('postgres','service_role') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Cancellazione dei dati a fine archivio, già autorizzata e verificata.
  if coalesce(current_setting('app.workspace_data_deletion', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_table_name = 'venues' then
    ws := new.workspace_id;
    -- La chiusura è una riduzione/sicurezza; non è una ripartenza commerciale.
    if (to_jsonb(new) - 'closed_at') = (to_jsonb(old) - 'closed_at') then return new; end if;
  elsif tg_table_name = 'venue_roles' then
    ws := private.venue_workspace(case when tg_op = 'DELETE' then old.venue_id else new.venue_id end);
  elsif tg_table_name = 'staff_documents' then
    select workspace_id into ws from public.workspace_members where id = new.member_id;
  else
    ws := new.id;
    -- Spegnere la chat è una revoca, disponibile anche in archivio.
    if not new.staff_can_chat then return new; end if;
  end if;
  perform private.assert_workspace_operational(ws);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- 4. Cosa verrebbe cancellato: solo conteggi, nessun contenuto.
create function private.workspace_data_inventory(p_workspace uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with v as (select id from public.venues where workspace_id = p_workspace),
       m as (select id from public.workspace_members where workspace_id = p_workspace)
  select jsonb_build_object(
    'venues', (select count(*) from v),
    'shifts', (select count(*) from public.shifts where venue_id in (select id from v)),
    'assignments', (select count(*) from public.shift_assignments where venue_id in (select id from v)),
    'clock_records', (select count(*) from public.shift_clock_records where venue_id in (select id from v)),
    'members', (select count(*) from m),
    'absences', (select count(*) from public.staff_absences where member_id in (select id from m)),
    'documents', (select count(*) from public.staff_documents where member_id in (select id from m)),
    'conversations', (select count(*) from public.conversations where workspace_id = p_workspace),
    'messages', (select count(*) from public.messages x join public.conversations c on c.id = x.conversation_id
                  where c.workspace_id = p_workspace),
    'notifications', (select count(*) from public.notifications where person_id in (select id from m)),
    'files_pending', (select count(*) from public.workspace_file_cleanup where workspace_id = p_workspace));
$$;
revoke all on function private.workspace_data_inventory(uuid) from public, anon, authenticated;

-- 5. Archivi scaduti ancora da cancellare, e quelli cancellati con file in coda.
create function public.admin_list_expired_archives(p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.require_platform_admin();
  perform private.validate_admin_page('', 25, p_offset);
  with rows as materialized (
    select w.id, w.name, w.deleted_at, w.data_deleted_at,
           private.workspace_access_at(w.id, now()) as access
      from public.workspaces w
     where w.data_deleted_at is null
        or exists (select 1 from public.workspace_file_cleanup f where f.workspace_id = w.id)),
  eligible as (
    select r.*, exists (select 1 from public.billing_subscriptions b
                         where b.workspace_id = r.id and b.status <> 'canceled') as subscription_open
      from rows r where r.access ->> 'state' = 'expired' or r.data_deleted_at is not null)
  select jsonb_build_object('generated_at', now(), 'total', (select count(*) from eligible),
    'limit', 25, 'offset', p_offset,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'workspace_id', e.id, 'workspace_name', e.name, 'deleted_at', e.deleted_at,
        'data_deleted_at', e.data_deleted_at, 'archive_until', e.access ->> 'archive_until',
        'subscription_open', e.subscription_open,
        'inventory', private.workspace_data_inventory(e.id))
        order by e.data_deleted_at nulls first, e.access ->> 'archive_until', e.id), '[]'::jsonb)
      from (select * from eligible order by data_deleted_at nulls first, access ->> 'archive_until', id
             limit 25 offset p_offset) e))
  into result;
  return result;
end;
$$;

-- 6. La cancellazione. Idempotente per operation_id; tutto o niente.
create function public.admin_delete_workspace_data(p_workspace uuid, p_operation uuid,
  p_confirm_name text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w public.workspaces;
  v_params jsonb := jsonb_build_object('confirm_name', p_confirm_name);
  v_replay jsonb;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  perform private.require_platform_admin();
  if p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then
    raise exception 'admin_reason_required' using errcode = '22023';
  end if;
  v_replay := private.admin_operation_replay(p_operation, 'workspace', p_workspace, 'delete_data', v_params);
  if v_replay is not null then return v_replay; end if;

  perform private.lock_commercial_workspace(p_workspace);
  select * into w from public.workspaces where id = p_workspace for update;
  if not found then raise exception 'admin_not_found' using errcode = 'P0002'; end if;
  if w.data_deleted_at is not null then
    raise exception 'admin_data_already_deleted' using errcode = '23514';
  end if;
  if p_confirm_name is null or btrim(p_confirm_name) <> btrim(w.name) then
    raise exception 'admin_confirm_name_mismatch' using errcode = '22023';
  end if;
  if private.workspace_access_at(p_workspace, now()) ->> 'state' <> 'expired' then
    raise exception 'admin_archive_not_expired' using errcode = '23514';
  end if;
  if exists (select 1 from public.billing_subscriptions
              where workspace_id = p_workspace and status <> 'canceled') then
    raise exception 'admin_subscription_open' using errcode = '23514';
  end if;

  v_before := private.workspace_data_inventory(p_workspace);
  -- Niente «Turno revocato» alle persone, niente guardie commerciali.
  perform set_config('app.staff_exit', '1', true);
  perform set_config('app.workspace_data_deletion', '1', true);

  -- File da togliere dallo Storage: documenti del personale e loghi delle sedi
  -- (caricati fra le foto, nella cartella di chi li ha messi). Un logo usato
  -- anche come foto profilo resta.
  insert into public.workspace_file_cleanup (workspace_id, bucket_id, object_name)
  select p_workspace, 'staff-documents', d.storage_path
    from public.staff_documents d join public.workspace_members m on m.id = d.member_id
   where m.workspace_id = p_workspace and btrim(coalesce(d.storage_path, '')) <> ''
  union
  select p_workspace, 'avatars', substring(v.logo_url from '/storage/v1/object/public/avatars/(.+)$')
    from public.venues v
   where v.workspace_id = p_workspace and v.logo_url ~ '/storage/v1/object/public/avatars/.+'
     and not exists (select 1 from public.profiles p where p.avatar_url = v.logo_url)
  on conflict (workspace_id, bucket_id, object_name) do nothing;

  delete from public.notifications
   where person_id in (select id from public.workspace_members where workspace_id = p_workspace);
  delete from public.conversations where workspace_id = p_workspace;
  -- Le timbrature non hanno FK verso la sede e bloccano la cancellazione dei turni.
  delete from public.shift_clock_records
   where venue_id in (select id from public.venues where workspace_id = p_workspace);
  delete from public.venues where workspace_id = p_workspace;
  -- Prima dei membri: un'azienda chiusa non pretende più un titolare.
  update public.workspaces
     set deleted_at = coalesce(deleted_at, now()), data_deleted_at = now()
   where id = p_workspace;
  delete from public.workspace_members where workspace_id = p_workspace;

  v_after := private.workspace_data_inventory(p_workspace);
  v_result := jsonb_build_object('workspace_id', p_workspace, 'data_deleted_at', now(),
    'deleted', v_before - 'files_pending', 'files_pending', v_after -> 'files_pending');
  insert into private.admin_operations (operation_id, actor_id, target_kind, target_id, action,
    reason, parameters, before_state, after_state, result, applied_at)
  values (p_operation, (select auth.uid()), 'workspace', p_workspace, 'delete_data',
    btrim(p_reason), v_params, v_before, v_after, v_result, now());
  return v_result;
end;
$$;

revoke all on function public.admin_list_expired_archives(integer),
  public.admin_delete_workspace_data(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_list_expired_archives(integer),
  public.admin_delete_workspace_data(uuid, uuid, text, text) to authenticated;
