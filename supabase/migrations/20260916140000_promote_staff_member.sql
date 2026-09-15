-- F3 — promuovere un membro dell'organico.
--
-- Il caso vero: «il mio capo sala organizza i turni». Quella persona ha già un
-- account, ma è `profiles.role = 'waiter'` — è un professionista, con i suoi
-- turni, le sue ore e la sua reputazione.
--
-- ⚠️ **Il ruolo non si cambia.** Portarlo a 'manager' gli porterebbe via la sua
-- identità di professionista: i turni assegnati, la card pubblica, le recensioni,
-- lo storico delle ore. E sarebbe irreversibile nei fatti, perché nessuna di
-- quelle cose sa tornare indietro. Il ruolo resta 'waiter' e gli si aggiunge un
-- **secondo cappello**: una riga `venue_access` come per qualunque altro
-- collaboratore, e nell'app un interruttore fra le due viste.
--
-- Da qui nasce l'unica regola nuova di questa fase: **un delegato non decide di
-- sé stesso**. Finché il collaboratore era un estraneo, "chi gestisce" e "chi
-- lavora" erano due insiemi disgiunti e non c'era niente da separare. Ora la
-- stessa persona può stare da entrambe le parti, e mettersi le ore in busta paga
-- da sola è un conflitto d'interessi che non si risolve con una schermata
-- nascosta: si vieta nel database.
--
-- ⚠️ Prerequisiti: 20260916120300, 20260916130000.

-- ---------------------------------------------------------------------------
-- 1. Un professionista può essere un collaboratore, se è già dell'organico
-- ---------------------------------------------------------------------------
-- `venue_access_user_matches_email` (20260916120300) pretende un account
-- `manager` la cui email confermata coincida con quella scritta sulla riga. È il
-- controllo che impedisce a un titolare di scrivere un `user_id` a caso e — per
-- via di `venues_owner_not_delegate` — di bloccare per sempre l'account di uno
-- sconosciuto.
--
-- La promozione ha bisogno di un'altra porta, e ne ha diritto: qui il legame con
-- la persona non è un indirizzo da verificare, è un'appartenenza che esiste già.
-- Se `user_id` è il professionista di una riga `staff_members` **viva in quella
-- stessa sede**, la relazione è provata meglio di quanto la proverebbe un'email.
-- Niente invito, niente indirizzo: si promuove dalla sua scheda.
--
-- ⚠️ La porta non si allarga oltre: `link_venue_access_for_user` continua a
-- rifiutare i ruoli diversi da 'manager'. Un professionista **non** diventa
-- collaboratore registrandosi con un indirizzo invitato — solo dall'organico di
-- chi lo conosce.
create or replace function public.venue_access_user_matches_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_role  public.user_role;
begin
  if new.user_id is null then
    return new;
  end if;

  -- Deroga 1: una persona che collabora già con questo titolare non va
  -- riverificata. Serve per `addTeamVenue` (una sede in più a chi c'è già) e per
  -- chi ha cambiato indirizzo dopo essersi collegato.
  if exists (
    select 1 from public.venue_access a
     where a.user_id  = new.user_id
       and a.owner_id = new.owner_id
       and a.status  <> 'revoked'
       and a.id      <> new.id
  ) then
    return new;
  end if;

  -- Deroga 2 (F3): il membro dell'organico promosso. L'appartenenza viva alla
  -- **stessa sede** è il legame, e la RLS di `staff_members` garantisce che solo
  -- chi gestisce quella sede possa averla creata.
  if exists (
    select 1 from public.staff_members sm
     where sm.waiter_id   = new.user_id
       and sm.venue_id    = new.venue_id
       and sm.link_status = 'active'
  ) then
    return new;
  end if;

  select lower(u.email) into v_email
    from auth.users u
    where u.id = new.user_id and u.email_confirmed_at is not null;

  if v_email is null or new.email is null
     or v_email <> lower(trim(new.email)) then
    raise exception 'user_email_mismatch';
  end if;

  select p.role into v_role from public.profiles p where p.id = new.user_id;
  if v_role is distinct from 'manager' then
    raise exception 'not_a_manager';
  end if;

  return new;
end;
$$;

revoke execute on function public.venue_access_user_matches_email()
  from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 2. «È mio?» — la domanda che prima non aveva senso
-- ---------------------------------------------------------------------------
-- Una definizione sola, usata dalla policy e dai due trigger: se divergessero, un
-- turno non modificabile dalla policy resterebbe scrivibile da un'altra strada.
--
-- ⚠️ Un **elenco**, non un predicato `is_own_staff_member(uuid)`. La forma
-- booleana sarebbe più naturale da leggere e sarebbe l'errore: dentro una policy
-- dipende dalla riga, quindi Postgres la chiamerebbe **una volta per riga** di
-- `shift_assignments`. `staff_member_id not in (select …)` non dipende dalla riga,
-- viene valutato una volta per statement come InitPlan, ed è la stessa ragione per
-- cui `my_venue_ids` è una `setof uuid` (20260916110000). Su questo progetto l'IO
-- del database è già finito una volta.
--
-- DEFINER: dentro una policy una funzione invoker che legge `staff_members`
-- ricadrebbe nelle policy di quella tabella.
create or replace function public.my_staff_member_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sm.id from public.staff_members sm
   where sm.waiter_id = (select auth.uid());
$$;

revoke execute on function public.my_staff_member_ids() from anon, public;
grant  execute on function public.my_staff_member_ids() to authenticated;

comment on function public.my_staff_member_ids() is
  'Le schede di sede di chi sta chiamando. Serve a vietare a un collaboratore promosso dall''organico di decidere dei propri turni e delle proprie ore. Per un titolare è sempre vuota: un titolare non è mai in organico (staff_members.waiter_id è un professionista).';

-- ---------------------------------------------------------------------------
-- 3. Nessuno si assegna i turni da sé
-- ---------------------------------------------------------------------------
-- La policy della F0, con una condizione in più. Per il titolare non cambia
-- niente: `staff_members.waiter_id` è un professionista, e un titolare in
-- organico non c'è mai — `my_staff_member_ids()` per lui è sempre vuota.
--
-- Il capo sala promosso continua a **vedere** i propri turni e a confermarli o
-- rifiutarli: quello passa dalle policy del lato professionista
-- ("shift_assignments: linked waiter read" e la sua update), che non si toccano.
-- Quello che non può fare è mettersi in turno, togliersi da un turno o segnarsi
-- presente dalla parte del gestore.
drop policy if exists "shift_assignments: owner all" on public.shift_assignments;
create policy "shift_assignments: owner all"
  on public.shift_assignments for all
  to authenticated
  using (
    exists (
      select 1 from public.shifts s
       where s.id = shift_assignments.shift_id
         and s.venue_id in (select public.my_venue_ids('shifts'))
    )
    and shift_assignments.staff_member_id not in (
      select public.my_staff_member_ids()
    )
  )
  with check (
    exists (
      select 1 from public.shifts s
       where s.id = shift_assignments.shift_id
         and s.venue_id in (select public.my_venue_ids('shifts'))
    )
    and shift_assignments.staff_member_id not in (
      select public.my_staff_member_ids()
    )
  );

-- ---------------------------------------------------------------------------
-- 4. E nessuno si scrive le proprie ore
-- ---------------------------------------------------------------------------
-- La policy sopra ferma insert e delete, ma non basta: l'update del consuntivo
-- arriva anche dal lato professionista (è così che si conferma un turno), e lì la
-- policy che passa è quella del waiter. `freeze_assignment_payroll` è il punto in
-- cui tutte le scritture si incontrano, e quindi è qui che la regola vale davvero.
--
-- Identica a 20260916130000 salvo `v_own`: chi tocca la **propria** assegnazione
-- torna ad avere i permessi di un professionista e basta, anche se su quella sede
-- è un collaboratore con tutti i permessi.
create or replace function public.freeze_assignment_payroll()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue     uuid;
  v_own       boolean;
  v_can_shift boolean;
  v_can_hours boolean;
  v_is_over   boolean;
begin
  -- Uscita a costo zero: gli update più frequenti non toccano nessuno di questi
  -- campi e non devono pagare un join per scoprirlo.
  if new.worked_hours is not distinct from old.worked_hours
     and new.role_id is not distinct from old.role_id
     and new.status  is not distinct from old.status
     and new.confirmed_at is not distinct from old.confirmed_at then
    return new;
  end if;

  select s.venue_id,
         public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
    into v_venue, v_is_over
    from public.shifts s
   where s.id = new.shift_id;

  v_own := new.staff_member_id in (select public.my_staff_member_ids());

  v_can_shift := not v_own
    and coalesce(public.can_manage_venue(v_venue, 'shifts'), false);
  v_can_hours := not v_own
    and coalesce(public.can_manage_venue(v_venue, 'hours'), false);

  if not v_can_hours then
    new.worked_hours := old.worked_hours;
  end if;

  if not v_can_shift then
    new.role_id := old.role_id;

    -- `coalesce(v_is_over, true)`: se il turno non si trova, si congela.
    if coalesce(v_is_over, true)
       or new.status not in ('confirmed', 'declined') then
      new.status := old.status;
    end if;
  end if;

  -- `confirmed_at` è derivato: è il timestamp del gesto di conferma del
  -- professionista. Chi gestisce il turno e segna una presenza a fine serata
  -- ('confirmed' = «c'era») non deve poterlo far comparire.
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    new.confirmed_at := case
      when v_can_shift then old.confirmed_at
      else now()
    end;
  elsif new.status in ('assigned', 'declined') then
    new.confirmed_at := null;
  else
    -- 'no_show' **non** azzera niente.
    new.confirmed_at := old.confirmed_at;
  end if;

  return new;
end;
$$;

revoke execute on function public.freeze_assignment_payroll()
  from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 5. Né si toglie dall'organico da sé
-- ---------------------------------------------------------------------------
-- Uscire dall'organico esiste già dal lato giusto: `leave_venue`, che non
-- cancella le ore e avvisa chi gestisce. Passare da qui vorrebbe dire uscire
-- usando i poteri che si hanno per gestire gli altri.
create or replace function public.remove_staff_member(p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter   uuid;
  v_venue_id uuid;
  v_owner    uuid;
  v_venue    text;
  v_name     text;
  v_future   int;
begin
  select sm.waiter_id, sm.venue_id, v.owner_id, v.name, sm.display_name
    into v_waiter, v_venue_id, v_owner, v_venue, v_name
    from public.staff_members sm
    join public.venues v on v.id = sm.venue_id
   where sm.id = p_staff_id and sm.link_status <> 'left';

  if v_venue_id is null
     or not public.can_manage_venue(v_venue_id, 'staff') then
    raise exception 'not allowed';
  end if;

  if p_staff_id in (select public.my_staff_member_ids()) then
    raise exception 'not allowed';
  end if;

  perform set_config('app.staff_exit', '1', true);

  with gone as (
    delete from public.shift_assignments a
     using public.shifts s
     where a.staff_member_id = p_staff_id
       and s.id = a.shift_id
       and public.shift_ends_at(s.date, s.start_time, s.end_time) > public.local_now()
    returning 1
  )
  select count(*) into v_future from gone;

  update public.staff_members
     set link_status = 'left',
         left_at = now()
   where id = p_staff_id;

  -- Chi non ha un account non riceve niente: non c'è nessuno a cui arrivare.
  if v_waiter is not null then
    insert into public.notifications (user_id, type, title, body, related_id)
    values (
      v_waiter,
      'staff_removed',
      'Collaborazione terminata',
      coalesce(v_venue, 'Un locale') || ' ti ha rimosso dal suo staff'
        || case
             when v_future = 1 then ' · 1 turno assegnato è stato annullato'
             when v_future > 1 then ' · ' || v_future || ' turni assegnati sono stati annullati'
             else ''
           end,
      null
    );
  end if;

  -- Il titolare lo viene a sapere quando non è stato lui a farlo.
  if v_owner is not null and v_owner <> (select auth.uid()) then
    insert into public.notifications (user_id, type, title, body, related_id)
    values (
      v_owner,
      'staff_response',
      'Un membro è uscito dall''organico',
      coalesce(v_name, 'Un professionista') || ' non fa più parte dello staff di '
        || coalesce(v_venue, 'un locale'),
      v_venue_id
    );
  end if;
end;
$$;

revoke execute on function public.remove_staff_member(uuid) from anon, public;
grant execute on function public.remove_staff_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Il delegato promosso legge il proprio profilo dal lato gestore
-- ---------------------------------------------------------------------------
-- `"profiles: delegate reads owner"` (20260916120000) dà al collaboratore il nome
-- del titolare. Al contrario, `"profiles: owner reads delegates"` è scritta per
-- un `owner_id = auth.uid()`: il titolare vede i suoi delegati. Entrambe reggono
-- anche quando il delegato è un professionista — `profiles` non filtra per ruolo
-- in nessuna delle due. Niente da cambiare, ed è scritto qui perché è la prima
-- domanda che viene in mente leggendo questa migration.
--
-- ⚠️ Quello che invece **resta vero e va ricordato**: un professionista promosso
-- non può aprire un locale suo finché la delega è viva
-- (`venues_owner_not_delegate`). Il titolare deve revocargliela. È il prezzo di
-- avere un solo `ownerId` nel provider, e si toglie con lo switcher azienda (F4).
