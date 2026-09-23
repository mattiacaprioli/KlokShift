-- File personali da eliminare prima di chiudere definitivamente auth.users.
--
-- La tabella è service-only: non ha GRANT per anon/authenticated e la RLS è
-- attiva. Conserva il riferimento anche dopo che `delete_account` ha eliminato
-- le righe documento e azzerato l'avatar del profilo. La Edge Function la
-- svuota soltanto dopo una risposta positiva dell'API Storage; in caso di
-- errore l'account Auth resta vivo e la stessa richiesta può ritentare.

create table public.account_file_cleanup (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  bucket_id       text not null check (bucket_id in ('avatars', 'staff-documents')),
  object_name     text not null check (btrim(object_name) <> ''),
  attempts        integer not null default 0 check (attempts >= 0),
  last_error_code text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, bucket_id, object_name)
);
create index account_file_cleanup_user_idx
  on public.account_file_cleanup (user_id, created_at, id);
alter table public.account_file_cleanup enable row level security;
create trigger account_file_cleanup_updated_at
  before update on public.account_file_cleanup
  for each row execute function public.update_updated_at();

-- `delete_account` resta additiva e idempotente, ma prima di cancellare i
-- metadati salva nella coda tutti i documenti caricati dall'account. Se questo
-- INSERT fallisce, l'intera RPC fa rollback: nessun riferimento viene perso.
create or replace function public.delete_account(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  insert into public.account_file_cleanup (user_id, bucket_id, object_name)
  select p_user, 'staff-documents', d.storage_path
    from public.staff_documents d
   where d.uploaded_by = p_user
  on conflict (user_id, bucket_id, object_name) do nothing;

  if not exists (select 1 from public.profiles p where p.id = p_user) then
    return;
  end if;

  delete from public.staff_documents where uploaded_by = p_user;

  delete from public.reviews         where waiter_id = p_user;
  delete from public.waiter_profiles where id        = p_user;

  -- Aziende di cui sono l'unico titolare attivo: si chiudono.
  for r in
    select m.workspace_id
      from public.workspace_members m
     where m.user_id = p_user and m.authority = 'owner' and m.status = 'active'
       and not exists (
         select 1 from public.workspace_members o
          where o.workspace_id = m.workspace_id and o.authority = 'owner'
            and o.status = 'active' and o.user_id is distinct from p_user
       )
  loop
    update public.workspaces set deleted_at = now() where id = r.workspace_id;
    update public.venues set closed_at = now()
     where workspace_id = r.workspace_id and closed_at is null;
    update public.shifts s set status = 'cancelled'
     where s.venue_id in (
       select v.id from public.venues v where v.workspace_id = r.workspace_id
     )
       and s.status <> 'cancelled'
       and public.shift_ends_at(s.date, s.start_time, s.end_time)
           > public.local_now();
  end loop;

  -- Tutte le mie appartenenze: si esce e si slega l'account dalla scheda.
  for r in
    select m.id from public.workspace_members m
     where m.user_id = p_user and m.status <> 'left'
  loop
    perform private.leave_workspace(r.id);
  end loop;
  update public.workspace_members set user_id = null where user_id = p_user;

  delete from public.push_tokens   where user_id = p_user;
  delete from public.notifications where user_id = p_user;

  update public.profiles set
    full_name = 'Utente eliminato', avatar_url = null, phone = null, city = null,
    notification_prefs = '{}'::jsonb, deleted_at = now()
  where id = p_user;
end;
$$;
