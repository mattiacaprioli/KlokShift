-- La conferma del turno la chiede solo chi ha davvero una scelta da fare.
--
-- Finora ogni assegnazione nasceva 'assigned' e **chiunque** doveva premere
-- «Conferma presenza». Per il dipendente fisso quel gesto non significa niente:
-- il turno è il suo lavoro, non un invito. Il danno non è solo il rumore — è che
-- lo stato 'assigned' diventa illeggibile per il titolare, perché mescola «non ha
-- ancora risposto» e «non deve rispondere».
--
-- Da qui:
--
--   staff_members.employment_type = 'fisso'       → l'assegnazione nasce 'confirmed'
--   staff_members.employment_type = 'a_chiamata'  → nasce 'assigned', deve confermare
--   shifts.require_confirmation = true            → nasce 'assigned' per tutti
--
-- L'override per turno serve ai casi in cui anche al fisso si chiede un sì
-- esplicito: straordinario, festivo, turno in un'altra sede.
--
-- ⚠️ `employment_type` sta su `staff_members` (persona × sede), non su
-- `staff_people`: chi è fisso a Roma e a chiamata a Milano è trattato in modo
-- diverso nelle due sedi, ed è la cosa giusta — il turno appartiene a una sede.

-- ---------------------------------------------------------------------------
-- 1) Le due colonne
-- ---------------------------------------------------------------------------
alter table public.shifts
  add column if not exists require_confirmation boolean not null default false;

comment on column public.shifts.require_confirmation is
  'Chiede la conferma a tutti gli assegnati, fissi compresi. Di norma false: conferma solo chi è a chiamata.';

-- `confirmed_at` distingue «ha confermato» da «non doveva confermare»: due
-- situazioni che nello `status` sono la stessa riga ('confirmed'). Senza, il
-- fisso leggerebbe «Hai confermato la presenza» pur non avendo mai toccato
-- niente, e dopo una modifica di orario il titolare non avrebbe **nessuna**
-- prova di presa visione.
alter table public.shift_assignments
  add column if not exists confirmed_at timestamptz;

comment on column public.shift_assignments.confirmed_at is
  'Quando il professionista ha confermato di persona. Null su chi non doveva confermare (dipendente fisso). Lo scrive solo freeze_assignment_payroll: non è un campo del client.';

-- ---------------------------------------------------------------------------
-- 2) Chi non deve confermare nasce già confermato
-- ---------------------------------------------------------------------------
-- BEFORE INSERT e non lato client perché le strade che creano un'assegnazione
-- sono cinque e nessuna deve poterselo dimenticare: creazione turno (app e web),
-- modifica turno, duplicazione di un periodo (`createInternalShifts`) e
-- `reassign_shift_assignment`.
create or replace function public.default_assignment_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_required boolean;
  v_type     public.employment_type;
begin
  -- Solo sul valore di default. Chi passa uno status esplicito sa quello che fa
  -- (un seed, una correzione), e non va sovrascritto.
  if new.status <> 'assigned' then
    return new;
  end if;

  select s.require_confirmation, sm.employment_type
    into v_required, v_type
    from public.shifts s
    cross join public.staff_members sm
   where s.id = new.shift_id
     and sm.id = new.staff_member_id;

  -- Turno o persona non trovati (non dovrebbe: ci sono le foreign key): si
  -- lascia 'assigned', che è lo stato che chiede conferma. Fail-closed verso il
  -- gesto in più, mai verso il turno dato per buono.
  if coalesce(v_required, true) then
    return new;
  end if;

  if v_type = 'fisso' then
    new.status := 'confirmed';
    -- confirmed_at resta null di proposito: nessuno ha confermato niente.
  end if;

  return new;
end;
$$;

revoke execute on function public.default_assignment_confirmation()
  from anon, authenticated, public;

comment on function public.default_assignment_confirmation() is
  'Un''assegnazione nasce già confermata se la persona è un dipendente fisso in quella sede e il turno non chiede la conferma esplicita.';

drop trigger if exists shift_assignments_default_confirmation on public.shift_assignments;
create trigger shift_assignments_default_confirmation
  before insert on public.shift_assignments
  for each row execute function public.default_assignment_confirmation();

-- ---------------------------------------------------------------------------
-- 3) confirmed_at lo scrive il database, non il client
-- ---------------------------------------------------------------------------
-- Stessa funzione di 20260913110000 (leggere lì il perché di ogni riga), con in
-- più la gestione di `confirmed_at`.
--
-- La policy `"shift_assignments: linked waiter update"` (20260712075549:56) è
-- FOR UPDATE **senza restrizioni di colonna**: senza questo trigger il
-- professionista potrebbe scriversi da sé un `confirmed_at` di comodo — cioè
-- fabbricare la prova di aver visto una modifica che non ha mai visto. Il valore
-- non viene mai accettato da fuori: o lo calcola il trigger, o resta quello di
-- prima.
create or replace function public.freeze_assignment_payroll()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_owner boolean;
  v_is_over  boolean;
begin
  -- Uscita a costo zero: gli update più frequenti non toccano nessuno di questi
  -- campi e non devono pagare un join per scoprirlo.
  if new.worked_hours is not distinct from old.worked_hours
     and new.role_id is not distinct from old.role_id
     and new.status  is not distinct from old.status
     and new.confirmed_at is not distinct from old.confirmed_at then
    return new;
  end if;

  select v.owner_id = (select auth.uid()),
         public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
    into v_is_owner, v_is_over
    from public.shifts s
    join public.venues v on v.id = s.venue_id
   where s.id = new.shift_id;

  if not coalesce(v_is_owner, false) then
    -- Chi scrive non è il titolare: i campi di consuntivo tornano al valore
    -- vecchio, in silenzio (non è un errore dell'utente, è una scrittura che non
    -- gli compete e che dall'interfaccia non esiste nemmeno).
    new.worked_hours := old.worked_hours;
    new.role_id      := old.role_id;

    -- `coalesce(v_is_over, true)`: se il turno non si trova, si congela.
    if coalesce(v_is_over, true)
       or new.status not in ('confirmed', 'declined') then
      new.status := old.status;
    end if;
  end if;

  -- `confirmed_at` è derivato, per entrambi i lati: è il timestamp del gesto di
  -- conferma del professionista. Il titolare che segna una presenza a fine turno
  -- ('confirmed' = «c'era») non deve poterlo far comparire: quella è una
  -- presenza constatata, non una conferma data in anticipo.
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    new.confirmed_at := case
      when coalesce(v_is_owner, false) then old.confirmed_at
      else now()
    end;
  elsif new.status in ('assigned', 'declined') then
    -- L'impegno è stato ritirato (rifiuto) o riaperto (turno modificato): la
    -- vecchia conferma non vale più.
    new.confirmed_at := null;
  else
    -- 'no_show' **non** azzera niente: «aveva confermato e non si è presentato»
    -- è esattamente il fatto che il titolare vuole poter rileggere.
    new.confirmed_at := old.confirmed_at;
  end if;

  return new;
end;
$$;

revoke execute on function public.freeze_assignment_payroll()
  from anon, authenticated, public;

comment on function public.freeze_assignment_payroll() is
  'Le colonne di consuntivo di shift_assignments (worked_hours, role_id, e status a turno concluso) le scrive solo il titolare del locale. Al professionista resta confermare o rifiutare un turno non ancora concluso. confirmed_at è derivato e non si scrive da fuori. Fail-closed: con auth.uid() nullo congela tutto.';

-- ---------------------------------------------------------------------------
-- 4) Cambiare il turno riapre la conferma
-- ---------------------------------------------------------------------------
-- Stessa funzione di 20260910120300 (un solo trigger per gli UPDATE di shifts),
-- con un'aggiunta nel ramo «turno modificato».
--
-- Finora una modifica di data/orario mandava la notifica e basta: chi aveva
-- confermato restava 'confirmed' anche se il turno si era spostato di un giorno,
-- e quella conferma valeva per un turno che non esiste più. La notifica dice che
-- è cambiato qualcosa; la conferma è l'unica cosa che dice che qualcuno l'ha
-- letta.
--
-- Vale **per tutti**, fissi compresi: è l'unico caso in cui al dipendente fisso
-- viene chiesto di rispondere, ed è giusto che succeda proprio qui.
create or replace function public.notify_on_shift_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue text;
  v_type  public.notification_type;
  v_title text;
  v_body  text;
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    v_type  := 'shift_cancelled';
    v_title := 'Turno annullato';
  elsif new.status <> 'cancelled'
        and (old.date, old.start_time, old.end_time)
            is distinct from (new.date, new.start_time, new.end_time)
  then
    v_type  := 'shift_updated';
    v_title := 'Turno modificato';
  elsif new.status <> 'cancelled'
        and new.require_confirmation and not old.require_confirmation
  then
    -- Il titolare ha acceso «richiedi conferma» su un turno già assegnato.
    v_type  := 'shift_updated';
    v_title := 'Conferma richiesta';
  else
    return new;
  end if;

  select name into v_venue from public.venues where id = new.venue_id;

  if v_type = 'shift_cancelled' then
    v_body := coalesce(v_venue, 'Un locale') || ' ha annullato «' || new.title
      || '» del ' || to_char(new.date, 'DD/MM');
  elsif v_title = 'Conferma richiesta' then
    v_body := coalesce(v_venue, 'Un locale') || ' chiede la conferma per «'
      || new.title || '» del ' || to_char(new.date, 'DD/MM');

    -- Solo chi non ha mai confermato di persona (`confirmed_at` null: i fissi
    -- confermati d'ufficio alla creazione). Chi aveva già detto sì non deve
    -- ridirlo perché è cambiata una regola del turno, non il turno.
    if public.shift_ends_at(new.date, new.start_time, new.end_time) > public.local_now() then
      update public.shift_assignments
         set status = 'assigned'
       where shift_id = new.id
         and status = 'confirmed'
         and confirmed_at is null;
    end if;
  else
    v_body := coalesce(v_venue, 'Un locale') || ' ha modificato «' || new.title
      || '»: ora ' || to_char(new.date, 'DD/MM') || ' · '
      || to_char(new.start_time, 'HH24:MI') || '–' || to_char(new.end_time, 'HH24:MI');

    -- La conferma torna da capo, **per tutti**: la vecchia valeva per un turno
    -- che non esiste più. Solo se il turno nuovo non è già concluso —
    -- correggere a posteriori l'orario di un turno lavorato non deve riaprire
    -- niente (e `freeze_assignment_payroll` lo rifiuterebbe comunque).
    -- `positions_filled` non si muove: 'assigned' e 'confirmed' contano uguale
    -- (sync_internal_positions_filled, 20260715130000).
    if public.shift_ends_at(new.date, new.start_time, new.end_time) > public.local_now() then
      update public.shift_assignments
         set status = 'assigned'
       where shift_id = new.id
         and status = 'confirmed';
    end if;
  end if;

  -- Un solo INSERT invece di due loop. `union` (non `union all`) copre il caso
  -- della stessa persona sia assegnata sia candidata accettata.
  insert into public.notifications (user_id, type, title, body, related_id)
  select w, v_type, v_title, v_body, new.id
  from (
    select sm.waiter_id as w
    from public.shift_assignments a
    join public.staff_members sm on sm.id = a.staff_member_id
    where a.shift_id = new.id
      and a.status in ('assigned', 'confirmed')
      and sm.waiter_id is not null
    union
    select ap.waiter_id
    from public.applications ap
    where ap.shift_id = new.id
      and ap.status = 'accepted'
  ) recipients;

  return new;
end;
$$;

revoke execute on function public.notify_on_shift_change() from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 5) La notifica di assegnazione dice se c'è qualcosa da fare
-- ---------------------------------------------------------------------------
-- AFTER INSERT, quindi `new.status` ha già passato
-- `default_assignment_confirmation`: qui si sa se alla persona è stata chiesta
-- una conferma oppure no, e il testo lo dice invece di lasciarlo scoprire.
create or replace function public.notify_on_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter uuid;
  v_title  text;
  v_venue  text;
begin
  select sm.waiter_id into v_waiter
    from public.staff_members sm where sm.id = new.staff_member_id;
  if v_waiter is null then
    return new;
  end if;

  select s.title, ve.name into v_title, v_venue
    from public.shifts s
    join public.venues ve on ve.id = s.venue_id
    where s.id = new.shift_id;

  insert into public.notifications (user_id, type, title, body, related_id)
  values (
    v_waiter,
    'shift_assigned',
    'Nuovo turno assegnato',
    'Sei stato assegnato a «' || coalesce(v_title, 'un turno') || '» da '
      || coalesce(v_venue, 'un locale')
      || case when new.status = 'assigned' then '. Conferma la presenza.' else '' end,
    new.shift_id
  );
  return new;
end;
$$;

revoke execute on function public.notify_on_assignment() from anon, authenticated, public;
