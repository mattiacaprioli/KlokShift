-- Recensioni dei clienti: rimosse (2026-10-04).
--
-- Erano sospese dal 2026-09-12 (`REVIEWS_ENABLED=false`): il prodotto è turni,
-- ore e chat, e la reputazione verso clienti sconosciuti era un secondo
-- prodotto. Via la tabella, il trigger del rating, le colonne `rating_*` e la
-- carta pubblica, che esisteva solo per il sito del QR: con lei cade l'ultima
-- porta per `anon` — nessuna tabella, nessuna funzione, nemmeno l'uso di
-- `private`.

-- `delete_account` cancellava anche le recensioni ricevute: stessa funzione,
-- senza quella riga. Il resto è identico a 20260923000100.
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

  delete from public.waiter_profiles where id = p_user;

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

drop table public.reviews;                         -- policy, trigger e indice con lei
drop function public.sync_waiter_rating();
drop function public.get_rating_breakdown(uuid);

drop view public.waiter_public_cards;
drop function public.get_waiter_public_card(uuid);
drop function private.waiter_public_cards_src();
revoke usage on schema private from anon;

alter table public.waiter_profiles
  drop column rating_avg,
  drop column rating_count;
