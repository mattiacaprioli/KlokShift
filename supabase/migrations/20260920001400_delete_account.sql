-- Baseline — 15/N: eliminazione account (anonimizzazione).
--
-- La chiama SOLO la Edge Function `delete-account` con service role (nessun GRANT
-- ad authenticated: il default di 20260920000000 lo esclude). Non cancella la
-- riga del profilo: la anonimizza, perché chat, storico e ore altrui la
-- referenziano.
--
--   * come professionista o collaboratore: esce dall'azienda; la scheda resta al
--     titolare, scollegata dall'account (il suo storico non sparisce);
--   * come titolare CON altri titolari: esce e basta;
--   * come titolare UNICO: l'azienda si chiude — sedi chiuse, turni futuri
--     annullati (gli assegnati vengono avvisati dal trigger), niente si cancella.
--
-- Prima di chiamarla la Edge Function raccoglie i percorsi dei documenti e dopo
-- toglie i blob dallo storage e l'utente da Auth.

create function public.delete_account(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  if not exists (select 1 from public.profiles p where p.id = p_user) then
    return;
  end if;

  delete from public.staff_documents where uploaded_by = p_user;

  delete from public.reviews            where waiter_id = p_user;
  delete from public.waiter_experiences where waiter_id = p_user;
  delete from public.waiter_profiles    where id        = p_user;

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
    update public.venues set closed_at = now() where workspace_id = r.workspace_id and closed_at is null;
    update public.shifts s set status = 'cancelled'
     where s.venue_id in (select v.id from public.venues v where v.workspace_id = r.workspace_id)
       and s.status <> 'cancelled'
       and public.shift_ends_at(s.date, s.start_time, s.end_time) > public.local_now();
  end loop;

  -- Tutte le mie appartenenze: si esce e si slega l'account dalla scheda.
  for r in select m.id from public.workspace_members m where m.user_id = p_user and m.status <> 'left' loop
    perform private.leave_workspace(r.id);
  end loop;
  update public.workspace_members set user_id = null where user_id = p_user;

  delete from public.push_tokens   where user_id = p_user;
  delete from public.notifications where user_id = p_user;

  update public.profiles set
    full_name = 'Utente eliminato', avatar_url = null, phone = null, bio = null, city = null,
    notification_prefs = '{}'::jsonb, deleted_at = now()
  where id = p_user;
end;
$$;
