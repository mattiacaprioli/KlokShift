-- I documenti sulla scheda aziendale restano all'azienda quando l'account che
-- li ha caricati viene eliminato.
--
-- Prima `delete_account` cancellava ogni `staff_documents` con
-- `uploaded_by = p_user`. Ma ogni documento sta sulla scheda di una persona in
-- un'azienda (`member_id`, file sotto `<member_id>/`), e quindi:
--   * il dipendente che si eliminava portava via il certificato che aveva
--     caricato sulla propria scheda, e all'azienda mancava per le buste paga;
--   * peggio, un titolare o collaboratore che si eliminava portava via i
--     contratti caricati sulle schede di tutti gli altri.
--
-- Da qui in poi il documento segue la scheda, non chi l'ha caricato: resta
-- all'azienda, con la scheda scollegata dall'account, e la sua conservazione la
-- decide il ciclo di vita dell'azienda (archivio e cancellazione dati), non
-- l'eliminazione di un account. `uploaded_by` resta e punta al profilo
-- anonimizzato («Utente eliminato»), come i messaggi in chat.
--
-- La coda `account_file_cleanup` continua a servire per gli avatar.

create or replace function public.delete_account(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  if not exists (select 1 from public.profiles p where p.id = p_user) then
    return;
  end if;

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
  -- I documenti della scheda restano con lei.
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
