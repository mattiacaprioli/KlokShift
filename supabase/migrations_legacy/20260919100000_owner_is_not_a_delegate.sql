-- Il titolare non è un delegato: in organico decide anche di sé stesso.
--
-- Dal 2026-09-17 il titolare può mettere **sé stesso** in organico e in turno.
-- Il caso vero è quello di sempre nell'ospitalità: il titolare lavora — fa il
-- servizio, copre un buco, sta al bar — e le sue ore oggi non esistono da
-- nessuna parte. Il modello lo permette già senza una colonna nuova: una riga
-- `staff_people` con `waiter_id` = il suo account, e le sue appartenenze.
--
-- Quello che NON lo permette è la regola nata con F3 (20260916140000), «un
-- delegato non decide di sé stesso»: `my_staff_member_ids()` torna tutte le
-- schede di chi chiama, e cinque punti la leggono come «conflitto
-- d'interessi». Il commento di quella funzione lo dice a voce alta — «per un
-- titolare è sempre vuota: un titolare non è mai in organico» — ed è
-- esattamente l'assunto che cade adesso. Con una scheda in organico il
-- titolare si troverebbe:
--
--   · le proprie `worked_hours` e il proprio `status` congelati in silenzio;
--   · nessun modo di segnarsi presente su un turno finito;
--   · `not allowed` se prova a togliersi la propria scheda;
--   · data e orari di un turno finito su cui ha lavorato non più correggibili.
--
-- ⚠️ **La regola non si annulla, si restringe a chi era scritta per.** Un
-- delegato ha qualcuno sopra di sé: mettersi le ore in busta paga da solo è un
-- conflitto, e resta vietato nel database. Un titolare non ha nessuno sopra di
-- sé — nessuno gli segnerà le presenze, e togliergli le proprie ore non
-- protegge nessuno: le lascia soltanto fuori dal conto, che è il problema da
-- cui parte questa migration.
--
-- ⚠️ Prerequisiti: 20260918170000 (e quindi 20260916140000, 20260918160000).

-- ---------------------------------------------------------------------------
-- 1. «Sono un delegato su questa scheda?»
-- ---------------------------------------------------------------------------
-- Una funzione **accanto** a `my_staff_member_ids()`, non al suo posto. Quella
-- continua a rispondere «le mie schede», che è la domanda giusta là dove serve
-- sapere chi sta chiamando e non chi ha l'ultima parola: §6.
--
-- Un elenco e non un predicato, per la ragione di 20260916140000 — dentro una
-- policy una forma booleana dipende dalla riga e Postgres la chiamerebbe una
-- volta per riga di `shift_assignments`; `not in (select …)` non dipende dalla
-- riga e si valuta una volta per statement (InitPlan).
--
-- `v.owner_id is distinct from auth.uid()` e non `<>`: con un `owner_id` nullo
-- (non succede, `venues.owner_id` è not null) `<>` darebbe null e la riga
-- uscirebbe dall'elenco, cioè **concederebbe**. Qui un dato inatteso deve
-- ricadere sul lato prudente.
--
-- In `private` e non in `public` per la ragione di `private.can_self_plan`:
-- PostgREST esporrebbe come RPC qualunque funzione in `public`. DEFINER perché
-- gira dentro le policy di `shift_assignments` e legge `staff_members` e
-- `venues`, che hanno policy proprie.
create or replace function private.my_delegate_staff_member_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sm.id
    from public.staff_members sm
    join public.venues v on v.id = sm.venue_id
   where sm.waiter_id = (select auth.uid())
     and v.owner_id is distinct from (select auth.uid());
$$;

revoke execute on function private.my_delegate_staff_member_ids() from public;
grant  execute on function private.my_delegate_staff_member_ids() to authenticated;

comment on function private.my_delegate_staff_member_ids() is
  'Le schede di chi chiama presso AZIENDE ALTRUI: cioè quelle su cui è un collaboratore e non il titolare. È l''elenco delle righe di cui non può decidere. Per un titolare che si è messo nel proprio organico è vuota — la regola «non decidi di te stesso» nasce per chi ha qualcuno sopra di sé.';

-- ---------------------------------------------------------------------------
-- 2. shift_assignments: il titolare torna a coprire anche le proprie righe
-- ---------------------------------------------------------------------------
-- Identica a 20260916140000 salvo la sorgente dell'elenco. Per il collaboratore
-- promosso non cambia niente: le sue schede sono presso l'azienda di un altro,
-- quindi restano escluse e continua a passare solo dalle due policy di
-- 20260918160000 (turni non finiti, `worked_hours` nulle).
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
      select private.my_delegate_staff_member_ids()
    )
  )
  with check (
    exists (
      select 1 from public.shifts s
       where s.id = shift_assignments.shift_id
         and s.venue_id in (select public.my_venue_ids('shifts'))
    )
    and shift_assignments.staff_member_id not in (
      select private.my_delegate_staff_member_ids()
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Le proprie ore: del titolare sì, del collaboratore no
-- ---------------------------------------------------------------------------
-- Identica a 20260918170000 salvo `v_own`, che ora è «sono un delegato su
-- questa riga» invece di «è una riga mia». È il punto in cui tutte le scritture
-- si incontrano — anche quelle che arrivano dal lato professionista, dove la
-- policy che passa è la sua — quindi è qui che la regola vale davvero.
--
-- Per il titolare `v_own` diventa falso: `v_can_shift`, `v_can_role` e
-- `v_can_hours` ricadono sui suoi permessi, che sono tutti. Si segna presente
-- a fine serata e si corregge le ore come fa per chiunque altro.
--
-- ⚠️ `confirmed_at` continua a NON comparire quando chi gestisce segna una
-- presenza (`v_can_shift` vero → si tiene il vecchio): quel timestamp è il
-- gesto di conferma di chi lavora. Sul turno che il titolare si è dato da sé lo
-- ha già scritto `default_assignment_confirmation` (§6) al momento dell'insert.
create or replace function public.freeze_assignment_payroll()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue     uuid;
  v_own       boolean;
  v_manages   boolean;
  v_can_shift boolean;
  v_can_role  boolean;
  v_can_hours boolean;
  v_is_over   boolean;
begin
  if new.shift_id is distinct from old.shift_id
     or new.staff_member_id is distinct from old.staff_member_id then
    raise exception 'assignment_identity_locked'
      using errcode = '42501',
            hint = 'Per spostare qualcuno si cancella la riga e se ne crea una nuova.';
  end if;

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

  v_own := new.staff_member_id in (select private.my_delegate_staff_member_ids());
  v_manages := coalesce(public.can_manage_venue(v_venue, 'shifts'), false);

  v_can_shift := not v_own and v_manages;
  -- `coalesce(v_is_over, true)`: se il turno non si trova, si congela.
  v_can_role := v_can_shift
    or (v_own and v_manages and not coalesce(v_is_over, true));
  v_can_hours := not v_own
    and coalesce(public.can_manage_venue(v_venue, 'hours'), false);

  if not v_can_hours then
    new.worked_hours := old.worked_hours;
  end if;

  if not v_can_role then
    new.role_id := old.role_id;
  end if;

  if not v_can_shift then
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
-- 4. Togliersi dall'organico
-- ---------------------------------------------------------------------------
-- Il collaboratore promosso non può: uscire dall'organico esiste dal lato
-- giusto (`leave_venue`, che non cancella le ore e avvisa chi gestisce), e
-- passare da qui vorrebbe dire uscire usando i poteri che si hanno per gestire
-- gli altri. Il titolare invece non ha nessun `leave_venue` da usare — l'azienda
-- è la sua — quindi senza questa riga la sua scheda sarebbe **inamovibile**.
--
-- ⚠️ Seconda correzione, e vale solo grazie alla prima: la notifica
-- «Collaborazione terminata» non parte più verso sé stessi. Prima non poteva
-- succedere (chi era sulla riga non arrivava fin qui); ora il titolare che si
-- toglie dall'organico riceverebbe «… ti ha rimosso dal suo staff» dalla propria
-- azienda. Stessa guardia del trigger gemello `notify_on_staff_removed`
-- (20260715140100).
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

  if p_staff_id in (select private.my_delegate_staff_member_ids()) then
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

  -- Chi non ha un account non riceve niente: non c'è nessuno a cui arrivare. E
  -- chi si è tolto da sé sa già di averlo fatto.
  if v_waiter is not null and v_waiter is distinct from (select auth.uid()) then
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
-- 5. Correggere data e orari di un turno finito su cui si è lavorato
-- ---------------------------------------------------------------------------
-- Identica a 20260918170000 salvo la sorgente dell'elenco. La regola resta
-- intera per il collaboratore: allungare un turno finito su cui si è sopra è
-- scriversi le ore, perché le ore sono la durata del turno quando nessuno le
-- corregge.
--
-- Per il titolare quello stesso gesto è il mestiere: ha fatto il servizio, è
-- finito alle due e non a mezzanotte, e nessun altro può sistemarlo. Gli resta
-- richiesto il permesso Ore, che ha sempre.
create or replace function public.guard_finished_shift_times()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.date is not distinct from old.date
     and new.start_time is not distinct from old.start_time
     and new.end_time   is not distinct from old.end_time then
    return new;
  end if;

  if public.shift_ends_at(old.date, old.start_time, old.end_time) > public.local_now()
     and public.shift_ends_at(new.date, new.start_time, new.end_time) > public.local_now() then
    return new;
  end if;

  if (select auth.uid()) is null then
    return new;
  end if;

  if not coalesce(public.can_manage_venue(old.venue_id, 'hours'), false)
     or not coalesce(public.can_manage_venue(new.venue_id, 'hours'), false)
     or exists (
       select 1 from public.shift_assignments a
        where a.shift_id = old.id
          and a.staff_member_id in (select private.my_delegate_staff_member_ids())
     ) then
    raise exception 'finished_shift_locked' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_finished_shift_times()
  from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 6. Fuori da questa migration, di proposito
-- ---------------------------------------------------------------------------
-- `default_assignment_confirmation` (20260918160000) resta su
-- `my_staff_member_ids()`, **non** filtrata. Là la domanda non è «chi ha
-- l'ultima parola» ma «chi sta entrando in turno»: mettersi in turno *è* la
-- conferma, e vale per il titolare come per il capo sala promosso. Filtrarla
-- lascerebbe il titolare con un turno «da confermare» che si è dato da sé, e
-- nessuna schermata dal lato gestione con cui confermarlo.
--
-- `private.can_self_plan` (20260918160000) resta com'è: è la strada del
-- collaboratore promosso, e il titolare non ne ha bisogno — dal §2 le proprie
-- righe ricadono di nuovo sotto `"shift_assignments: owner all"`, senza il
-- limite del turno non ancora finito.
--
-- Le policy del lato professionista ("shift_assignments: linked waiter read" e
-- la sua update) non si toccano: valgono per chiunque abbia una scheda, titolare
-- compreso, e sono quelle che gli fanno leggere i propri turni.
