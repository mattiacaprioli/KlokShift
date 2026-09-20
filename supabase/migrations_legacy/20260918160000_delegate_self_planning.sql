-- Il collaboratore promosso dall'organico si mette in turno da sé.
--
-- Ribalta metà della regola di 20260916140000 («un delegato non decide di sé
-- stesso»), per decisione di prodotto del 2026-09-17: il capo sala che organizza
-- i turni lavora anche lui, e aspettare che il titolare lo metta in turno era un
-- passaggio in più che non proteggeva niente. Pianificarsi non tocca il
-- consuntivo.
--
-- ⚠️ **L'altra metà resta: le proprie ore no.** Il confine è la fine del turno.
--   - Su un turno non ancora finito può entrare, uscire e cambiarsi mansione.
--   - Su un turno finito niente. Lì assegnarsi **è** scriversi le ore: le ore
--     sono `coalesce(worked_hours, durata)` per chiunque non sia 'declined' o
--     'no_show' (`features/assignments/hours.ts`), quindi una riga nuova su un
--     turno passato vale già un turno pagato. Presenze e ore sulle proprie righe
--     restano di chi gestisce la sede, come prima.
--   - `remove_staff_member` su sé stesso resta vietata: non è pianificazione.
--
-- ⚠️ Prerequisiti: 20260916140000.

-- ---------------------------------------------------------------------------
-- 1. «Posso pianificare me stesso su questo turno?»
-- ---------------------------------------------------------------------------
-- Una definizione sola per insert e delete: se divergessero, ci si potrebbe
-- mettere su un turno da cui poi non ci si toglie (o il contrario).
--
-- La scheda deve essere **della sede del turno** e viva. `my_staff_member_ids()`
-- da sola non basta: contiene anche le schede che la persona ha presso altre
-- aziende, e con quella si entrerebbe in un turno di Da Buffa con la scheda di
-- un altro titolare. La policy del titolare guarda solo il turno e non ha questo
-- controllo (lo fa `reassign_shift_assignment`); qui costa una join e si mette.
--
-- DEFINER per non espandere le policy di `staff_members` dentro quelle di
-- `shift_assignments` (vedi 20260918150000). In `private`, non in `public`:
-- PostgREST la esporrebbe come RPC.
create or replace function private.can_self_plan(
  p_shift        uuid,
  p_staff_member uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.shifts s
      join public.staff_members sm on sm.venue_id = s.venue_id
     where s.id  = p_shift
       and sm.id = p_staff_member
       and sm.waiter_id   = (select auth.uid())
       and sm.link_status = 'active'
       and public.can_manage_venue(s.venue_id, 'shifts')
       and public.shift_ends_at(s.date, s.start_time, s.end_time) > public.local_now()
  );
$$;

revoke execute on function private.can_self_plan(uuid, uuid) from public;
grant  execute on function private.can_self_plan(uuid, uuid) to authenticated;

comment on function private.can_self_plan(uuid, uuid) is
  'Chi chiama è un collaboratore con il permesso turni sulla sede, la scheda è sua, di quella sede e viva, e il turno non è finito. Serve ai collaboratori promossi dall''organico per mettersi in turno da sé senza poter toccare il consuntivo.';

-- ---------------------------------------------------------------------------
-- 2. Le due policy
-- ---------------------------------------------------------------------------
-- `"shift_assignments: owner all"` non si tocca: continua a escludere le righe
-- proprie, e quindi continua a coprire le presenze a turno finito. Queste due
-- si aggiungono accanto (le policy permissive vanno in OR).
--
-- Niente policy di update. Le righe proprie si aggiornano già da
-- `"linked waiter update"` (confermare, rifiutare), e cosa passa di
-- quell'update lo decide `freeze_assignment_payroll` (§5). Le sostituzioni
-- non sono un update: `reassign_shift_assignment` fa delete + insert, quindi
-- passare un proprio turno a un collega o prendere il suo usa le policy qui
-- sotto.
--
-- `worked_hours is null` sull'insert: il trigger delle ore scatta solo
-- sull'update, e senza questa riga si nascerebbe su un turno futuro con le ore
-- già scritte. Lo status invece non va controllato qui: lo impone §3.
drop policy if exists "shift_assignments: delegate self insert" on public.shift_assignments;
create policy "shift_assignments: delegate self insert"
  on public.shift_assignments for insert
  to authenticated
  with check (
    shift_assignments.worked_hours is null
    and private.can_self_plan(shift_assignments.shift_id, shift_assignments.staff_member_id)
  );

drop policy if exists "shift_assignments: delegate self delete" on public.shift_assignments;
create policy "shift_assignments: delegate self delete"
  on public.shift_assignments for delete
  to authenticated
  using (
    private.can_self_plan(shift_assignments.shift_id, shift_assignments.staff_member_id)
  );

-- ---------------------------------------------------------------------------
-- 3. Chi si mette in turno da sé ha già confermato
-- ---------------------------------------------------------------------------
-- Senza, finirebbe 'assigned' e dovrebbe confermare un turno che si è appena
-- dato. Il gesto di mettersi in turno **è** la conferma, quindi `confirmed_at`
-- vale adesso: non è il caso del fisso qui sotto, dove nessuno ha confermato.
--
-- ⚠️ Prima dell'uscita sul valore di default, di proposito: qui lo status che
-- arriva dal client non conta. Né un 'confirmed' con un `confirmed_at`
-- inventato, né un 'no_show'. Per un titolare `my_staff_member_ids()` è sempre
-- vuota (non è mai in organico), quindi per lui non cambia niente.
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
  if new.staff_member_id in (select public.my_staff_member_ids()) then
    new.status       := 'confirmed';
    new.confirmed_at := now();
    return new;
  end if;

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

-- ---------------------------------------------------------------------------
-- 4. E non si manda la notifica da solo
-- ---------------------------------------------------------------------------
-- «Nuovo turno assegnato» a chi l'ha appena fatto è rumore, e da M7 è anche una
-- push. Stessa uscita che `notify_on_assignment_removed` ha già per chi si
-- toglie da sé.
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

  if v_waiter = (select auth.uid()) then
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
      || coalesce(v_venue, 'una sede')
      || case when new.status = 'assigned' then '. Conferma la presenza.' else '' end,
    new.shift_id
  );
  return new;
end;
$$;

revoke execute on function public.notify_on_assignment()
  from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 5. La mansione sul proprio turno sì, presenze e ore no
-- ---------------------------------------------------------------------------
-- Identica a 20260916140000 salvo `v_can_role`. Cambiarsi mansione («stasera
-- faccio il bar») è pianificazione, e senza questo il «Salva» del turno
-- tornerebbe 200 lasciando la mansione di prima: `updateInternalShift` fa un
-- update senza `.select()`, quindi non se ne accorgerebbe nessuno.
--
-- ⚠️ `v_can_shift` resta `not v_own`: governa lo **status** a turno finito,
-- cioè presente/assente, cioè le ore. E governa `confirmed_at`: sulle righe
-- proprie confermare resta il gesto del professionista, con il suo timestamp.
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
