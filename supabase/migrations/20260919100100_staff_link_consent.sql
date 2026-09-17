-- Il consenso del professionista smette di essere una regola del client.
--
-- `staff_members.link_status` nasce `'active'` (default di 20260712085513: la
-- scheda senza account è attiva da subito, e va bene così) e nessuna policy
-- guarda `waiter_id`. Messe insieme, le due cose dicono che chi gestisce una
-- sede può inserire via REST una scheda con `waiter_id` = un profilo qualunque
-- e trovarselo in organico **attivo**, senza nessun invito da accettare: turni
-- assegnati, notifiche, e — via `"profiles: manager reads own staff"` — la
-- lettura del profilo e della scheda professionale di quella persona.
--
-- Gli uuid non sono un segreto: `waiter_public_cards` è a lettura pubblica.
--
-- Il passaggio per `'pending'` esiste solo in `addStaff` (`features/staff/api.ts`),
-- cioè nel posto che un client confezionato a mano non attraversa. Tutte le
-- strade legittime invece passano da qui:
--
--   · **scheda senza account** → `waiter_id` nullo: niente da chiedere a nessuno;
--   · **invito in-app** → nasce `'pending'`, e ad accettarlo è la persona stessa
--     (`respond_to_staff_invite`);
--   · **invito per email** → la scheda è già attiva ma senza account, e il
--     `waiter_id` lo attacca `link_staff_invites_for_user` quando quella persona
--     si registra con quell'indirizzo confermato. Il consenso è la registrazione;
--   · **mettersi da sé** (20260919100000 e `addSelfToStaff`, 17/09) → `waiter_id`
--     è chi sta chiamando: il consenso è il gesto.
--
-- Questa migration nasce insieme all'autoinserimento, e non per caso: è lo
-- stesso confine visto dai due lati. «Posso scrivere una scheda attiva con
-- l'account di qualcuno» ha una risposta sola — *se quel qualcuno sono io, o se
-- me l'ha detto lui*.
--
-- ⚠️ Prerequisiti: nessuno. Indipendente da 20260919100000.

-- ---------------------------------------------------------------------------
-- 1. Le due RPC che portano un consenso dichiarano di averlo
-- ---------------------------------------------------------------------------
-- Stesso schema di `app.staff_exit` (20260914103531): una variabile di
-- sessione, `true` come terzo argomento perché valga solo per la transazione in
-- corso. Non è una password — chi potesse eseguire `set_config` a mano potrebbe
-- anche scrivere la riga — ma queste due funzioni sono DEFINER e sono l'unica
-- strada che il client ha per far diventare attiva la scheda di un altro.
create or replace function public.respond_to_staff_invite(p_staff_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter uuid;
begin
  select waiter_id into v_waiter
    from public.staff_members
    where id = p_staff_id and link_status = 'pending';

  if v_waiter is null or v_waiter <> (select auth.uid()) then
    raise exception 'not allowed';
  end if;

  if p_accept then
    -- È la persona stessa ad accettare: il consenso c'è, e §2 lo lascia passare.
    perform set_config('app.staff_consent', '1', true);
    update public.staff_members set link_status = 'active' where id = p_staff_id;
  else
    delete from public.staff_members where id = p_staff_id;
  end if;
end;
$$;

revoke execute on function public.respond_to_staff_invite(uuid, boolean) from anon, public;
grant  execute on function public.respond_to_staff_invite(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Il guard
-- ---------------------------------------------------------------------------
-- Vale su insert e su update, perché le due strade per arrivare allo stesso
-- punto sono «nasco attiva con un account» e «divento attiva dopo».
--
-- `auth.uid()` nullo passa: service role, editor SQL, e — importante —
-- `link_staff_invites_for_user` quando gira dentro il trigger di registrazione
-- ha invece `auth.uid()` = la persona che si sta registrando, cioè proprio il
-- `waiter_id` che sta scrivendo. Entrambi i casi sono coperti senza un ramo
-- apposta.
--
-- ⚠️ Non tocca `left`: chiudere un'appartenenza non chiede il consenso di
-- nessuno, e `remove_staff_member` non deve dichiarare niente.
create or replace function public.guard_staff_link_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Senza un account collegato non c'è nessuno da cui avere un consenso.
  if new.waiter_id is null or new.link_status <> 'active' then
    return new;
  end if;

  -- Update che non cambia né l'account né lo stato: non è questo il momento in
  -- cui il consenso si dà, e gli update frequenti (tipo di impiego, mirror del
  -- nome) non pagano niente.
  if tg_op = 'UPDATE'
     and old.waiter_id is not distinct from new.waiter_id
     and old.link_status is not distinct from new.link_status then
    return new;
  end if;

  if (select auth.uid()) is null
     or new.waiter_id = (select auth.uid())
     or coalesce(current_setting('app.staff_consent', true), '') = '1' then
    return new;
  end if;

  -- Quarta strada: con questa azienda il consenso **c'è già**. Se la stessa
  -- persona ha un'altra appartenenza attiva con lo stesso account, un giorno ha
  -- accettato — e aggiungerle una sede (`addPersonToVenue`) o riprenderla dove
  -- aveva smesso (`reviveMembership`) non è farla entrare, è spostarla dentro
  -- un accordo che esiste. È la stessa deroga di
  -- `venue_access_user_matches_email` per chi collabora già.
  --
  -- ⚠️ Solo `'active'`: chi ha lasciato **tutte** le sedi l'accordo l'ha
  -- chiuso, e rimetterlo in organico senza chiederglielo sarebbe decidere al
  -- posto suo. La UI dice la stessa cosa (`canReassign`), e qui diventa una
  -- regola invece di una scelta di schermata.
  --
  -- DEFINER, quindi questa lettura non ripassa dalle policy di
  -- `staff_members`: nessuna ricorsione (vedi 20260918150000).
  if exists (
    select 1 from public.staff_members sm
     where sm.person_id   = new.person_id
       and sm.id         <> new.id
       and sm.waiter_id   = new.waiter_id
       and sm.link_status = 'active'
  ) then
    return new;
  end if;

  raise exception 'staff_link_needs_consent' using errcode = '42501';
end;
$$;

revoke execute on function public.guard_staff_link_consent()
  from anon, authenticated, public;

drop trigger if exists staff_members_guard_link_consent on public.staff_members;
create trigger staff_members_guard_link_consent
  before insert or update of waiter_id, link_status on public.staff_members
  for each row execute function public.guard_staff_link_consent();

comment on function public.guard_staff_link_consent() is
  'Una scheda non diventa attiva con l''account di un''altra persona senza il suo consenso: o è lei a chiamare, o la riga arriva da respond_to_staff_invite. Chiude la strada per cui chi gestisce una sede poteva scrivere un waiter_id qualunque con link_status active e mettersi in organico uno sconosciuto.';

-- ---------------------------------------------------------------------------
-- 3. Nota su `staff_people.waiter_id`
-- ---------------------------------------------------------------------------
-- Il `waiter_id` lo scrive il client sulla **persona**, e un trigger lo copia
-- sulle appartenenze (`staff_people_sync_members`, 20260913100000). Quella copia
-- è un update di `waiter_id` su `staff_members`, quindi passa da qui: il guard
-- sta sulla tabella giusta e non serve un secondo trigger sulla persona.
--
-- Conseguenza voluta: collegare a mano un account a una scheda già attiva
-- scrivendo `staff_people.waiter_id` ora **fallisce** se quell'account non è il
-- proprio e con l'azienda non c'è già un'appartenenza attiva. Era l'ultima
-- porta aperta, ed è la stessa da cui passa `addStaff` per l'invito in-app —
-- che però scrive `link_status = 'pending'` e quindi non la attraversa.
