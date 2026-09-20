-- Due buchi che facevano cadere la regola di 20260918160000 («il collaboratore
-- promosso si mette in turno da sé, ma le proprie ore no»).
--
--   1. Una riga di `shift_assignments` cambiava turno e persona con un update.
--      Lo permetteva a **qualunque** professionista la policy `linked waiter
--      update`, che controlla di chi è la riga e non quali colonne cambiano:
--      bastava una chiamata diretta all'API per spostarsi da lunedì a sabato
--      scorso e ritrovarsi ore mai lavorate, senza che la sede ricevesse niente.
--   2. Data e orari di un turno finito si cambiavano con il solo permesso Turni.
--      Le ore sono la durata del turno quando nessuno le corregge, quindi
--      allungare un turno finito su cui si è sopra era scriversi le ore.
--
-- ⚠️ Prerequisiti: 20260918160000.

-- ---------------------------------------------------------------------------
-- 1. Una riga non cambia turno né persona
-- ---------------------------------------------------------------------------
-- Spostare qualcuno è sempre «togli da lì, metti qui»: delete + insert, che
-- ripassano dalle policy e quindi dalla domanda «gestisci i turni di questa
-- sede?». Così il permesso di spostarsi discende da quello di mettersi e
-- togliersi, e non è una regola a parte da tenere allineata: il professionista
-- non ha né insert né delete e non si sposta; il collaboratore promosso li ha
-- sui turni non finiti (`private.can_self_plan`) e si sposta lì; il titolare
-- sposta tutti.
--
-- Nessun chiamante lo faceva: `reassign_shift_assignment` fa delete + insert
-- apposta, e il trascinamento «cambia giorno» del planning sposta il turno, non
-- la riga. Le FK nemmeno (cascade, non set null). Vale anche per il service
-- role: una correzione a mano si fa allo stesso modo.
--
-- Il resto è identico a 20260918160000. Il controllo sta prima dell'uscita a
-- costo zero, che queste due colonne non le guarda.
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

-- ---------------------------------------------------------------------------
-- 2. Un turno finito è consuntivo: data e orari chiedono il permesso Ore
-- ---------------------------------------------------------------------------
-- Stessa regola di `worked_hours` qui sopra, perché è lo stesso dato visto da
-- un'altra parte:
--   - serve il permesso **Ore** (`'hours'`), non basta Turni;
--   - e **mai** se chi chiama è su quel turno: nemmeno con il permesso Ore ci si
--     scrive le proprie.
--
-- «Finito» guarda **sia** il turno com'era **sia** com'è dopo la modifica:
-- portare nel passato un turno futuro su cui ci si è messi da soli è la strada
-- più corta per un turno pagato e mai fatto.
--
-- Per il titolare non cambia niente: ha tutti i permessi e non è mai in
-- organico. L'app nasconde già la modifica dei turni finiti; il web no, ed è lì
-- che un collaboratore senza il permesso Ore vedrà il messaggio
-- (`lib/errors.ts`, `finished_shift_locked`).
--
-- `auth.uid()` nullo passa: è il service role o l'editor SQL. `anon` non arriva
-- fin qui, perché nessuna policy di `shifts` gli dà l'update.
--
-- `before update of date, start_time, end_time`: gli altri update (titolo,
-- note, stato) non pagano niente.
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
          and a.staff_member_id in (select public.my_staff_member_ids())
     ) then
    raise exception 'finished_shift_locked' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_finished_shift_times()
  from anon, authenticated, public;

drop trigger if exists shifts_guard_finished_times on public.shifts;
create trigger shifts_guard_finished_times
  before update of date, start_time, end_time on public.shifts
  for each row execute function public.guard_finished_shift_times();
