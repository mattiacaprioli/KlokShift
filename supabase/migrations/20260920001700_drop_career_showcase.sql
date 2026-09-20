-- Baseline — 18/N: via il CV/vetrina dal profilo del professionista.
--
-- Il profilo professionale era una vetrina da marketplace: chi non ti conosce ti
-- sceglie da come ti racconti. Il marketplace è stato rimosso il 2026-09-12 e chi
-- legge questo profilo oggi ha già la persona in azienda (la policy di lettura è
-- `private.visible_profile_ids()`) — la scheda di organico è dove guarda, e lì un
-- curriculum non serve a decidere niente.
--
-- Restano `primary_role` e `languages`: le lingue sono un dato operativo — chi
-- compone la sala vuole sapere chi parla inglese — e si leggono ora dalla scheda
-- di organico, non da una pagina a parte.
--
-- Cadono anche cinque colonne che nessun client ha mai scritto: erano il modulo
-- di candidatura (anni di esperienza, disponibilità, tariffa minima, CV, allegati).

-- ---------------------------------------------------------------------------
-- 1. Le esperienze. Con la tabella cadono indice, CHECK, policy e GRANT.
-- ---------------------------------------------------------------------------
drop table public.waiter_experiences;

-- ---------------------------------------------------------------------------
-- 2. `delete_account` cancellava le esperienze e azzerava la bio.
--
-- Il corpo di una funzione plpgsql non è una dipendenza che Postgres traccia: il
-- drop qui sopra passa senza dire niente e la funzione esploderebbe alla prossima
-- eliminazione di account. Si riscrive ora, nella stessa transazione.
-- `create or replace` conserva ACL e SECURITY DEFINER.
-- ---------------------------------------------------------------------------
create or replace function public.delete_account(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
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
    full_name = 'Utente eliminato', avatar_url = null, phone = null, city = null,
    notification_prefs = '{}'::jsonb, deleted_at = now()
  where id = p_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. I campi vetrina e le cinque colonne morte.
--
-- `experience` era testo libero («6 anni · Sala alta cucina»): l'utente lo
-- compilava e non compariva da nessuna parte. `specializations` ripeteva il
-- ruolo. La `bio` chiedeva di raccontarsi a chi cerca personale, e chi legge il
-- profilo ha già assunto.
--
-- Il privilegio per colonna cade con la colonna: i GRANT rimasti su
-- `waiter_profiles` non vanno riemessi, restano `id, primary_role, languages`
-- (e `rating_*` fuori, che li tiene il trigger).
-- ---------------------------------------------------------------------------
alter table public.waiter_profiles
  drop column experience,
  drop column specializations,
  drop column years_experience,
  drop column availability_days,
  drop column hourly_rate_min,
  drop column cv_url,
  drop column documents;

alter table public.profiles drop column bio;
