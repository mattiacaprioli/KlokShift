-- Le ore lavorate non le scrive chi le lavora.
--
-- `"shift_assignments: linked waiter update"` (20260712075549:56) esiste perché il
-- professionista possa **confermare o rifiutare** un turno, ma è una policy `FOR
-- UPDATE` **senza restrizioni di colonna**: dal client, con la anon key, bastava
--
--     update shift_assignments set worked_hours = 12 where id = <la sua>
--
-- Da 20260912120000 il `role_id` era protetto da `freeze_assignment_role`; la
-- colonna che conta di più — `worked_hours` — non lo era. Finché le ore erano una
-- statistica si poteva discutere; da 20260913110100 sono l'input della busta paga,
-- e allora è semplicemente inaccettabile.
--
-- ── Perché un trigger e non la RLS ───────────────────────────────────────────
--
--   · una policy non può esprimere «non hai cambiato *questa* colonna»: il
--     `with check` non vede `OLD`;
--   · `revoke update(worked_hours) on shift_assignments from authenticated` non
--     distingue i due lati — il titolare scrive quella colonna dal **medesimo**
--     ruolo `authenticated` (`setAssignmentPresence`), quindi la perderebbe anche lui.
--
-- ── Chi può scrivere cosa ────────────────────────────────────────────────────
--
--   worked_hours   titolare: libero   professionista: sempre congelato
--   role_id        titolare: libero   professionista: sempre congelato (com'era)
--   status         titolare: libero   professionista: solo → 'confirmed'/'declined',
--                                     e solo a turno NON concluso
--
-- Le due restrizioni su `status` sono necessarie per ragioni diverse:
--
--   · **`no_show` è del titolare.** Non è una risposta a un invito, è un giudizio
--     su una presenza — e porta le ore a 0 nel riepilogo, cioè è già una
--     scrittura sul cedolino.
--   · **A turno concluso lo `status` non si tocca più.** Senza questa metà, un
--     `declined` scritto il giorno dopo cancellerebbe ore già lavorate e già
--     viste dal titolare: lo stesso buco, dalla porta accanto. Confermare è un
--     gesto di *prima*; l'unico caso legittimo dopo è «non si è presentato», e
--     quello lo mette il titolare.
--
-- Verificato prima di scrivere questa regola: il client del professionista scrive
-- **solo** 'confirmed' e 'declined' (`(waiter)/(tabs)/index.tsx`, `turni.tsx`,
-- `shift/[id].tsx`), e `worked_hours` la scrivono solo le schermate del gestore
-- (`(manager)/shift/[id].tsx`, `web/src/shifts/PresenceSection.tsx`). Nessun
-- flusso esistente si rompe. Nello stesso commit i bottoni «Conferma presenza» /
-- «Non posso» vengono nascosti sui turni conclusi: erano mostrati in base al solo
-- `status`, e da qui in poi sarebbero diventati un no-op silenzioso.
--
-- ── Sostituisce freeze_assignment_role, non si accoda ────────────────────────
--
-- Quello era l'**unico** trigger BEFORE UPDATE su questa tabella (verificato in
-- `pg_trigger`): due trigger farebbero due volte lo stesso lookup
-- `shifts → venues` a ogni conferma di turno.
--
-- ⚠️ Con `auth.uid()` nullo (postgres, service_role, MCP, una query dalla
-- dashboard) `v_is_owner` è falso e il trigger **congela anche quelle
-- scritture**. È la stessa semantica fail-closed che `freeze_assignment_role`
-- aveva già, ed è quella giusta per una colonna che alimenta un cedolino. Nessun
-- percorso server-side aggiorna `shift_assignments` (`reassign_shift_assignment`
-- fa delete+insert, di proposito, per far scattare le notifiche). Una correzione
-- a mano va fatta impersonando il titolare:
--     select set_config('request.jwt.claims',
--       json_build_object('sub', '<owner uuid>', 'role', 'authenticated')::text, true);
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
  -- Uscita a costo zero. Gli update più frequenti su questa tabella non toccano
  -- nessuno dei tre campi (il trigger dei coperti, un tocco su una colonna
  -- qualsiasi) e non devono pagare un join per scoprirlo.
  if new.worked_hours is not distinct from old.worked_hours
     and new.role_id is not distinct from old.role_id
     and new.status  is not distinct from old.status then
    return new;
  end if;

  select v.owner_id = (select auth.uid()),
         public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
    into v_is_owner, v_is_over
    from public.shifts s
    join public.venues v on v.id = s.venue_id
   where s.id = new.shift_id;

  if coalesce(v_is_owner, false) then
    -- Chi organizza decide: ore, ruolo, presenza.
    return new;
  end if;

  -- Da qui in giù chi scrive non è il titolare. Il valore vecchio viene rimesso
  -- **in silenzio**: non è un errore dell'utente, è una scrittura che non gli
  -- compete, e dall'interfaccia non esiste nemmeno il gesto per farla. Stessa
  -- scelta di `freeze_assignment_role` e del mirror in
  -- `sync_staff_member_from_person` (20260913100000).
  new.worked_hours := old.worked_hours;
  new.role_id      := old.role_id;

  -- `coalesce(v_is_over, true)`: se il turno non si trova, si congela.
  if coalesce(v_is_over, true)
     or new.status not in ('confirmed', 'declined') then
    new.status := old.status;
  end if;

  return new;
end;
$$;

revoke execute on function public.freeze_assignment_payroll()
  from anon, authenticated, public;

comment on function public.freeze_assignment_payroll() is
  'Le colonne di consuntivo di shift_assignments (worked_hours, role_id, e status a turno concluso) le scrive solo il titolare del locale. Al professionista resta confermare o rifiutare un turno non ancora concluso. Fail-closed: con auth.uid() nullo congela tutto.';

drop trigger if exists shift_assignments_freeze_role on public.shift_assignments;
drop function if exists public.freeze_assignment_role();

create trigger shift_assignments_freeze_payroll
  before update on public.shift_assignments
  for each row execute function public.freeze_assignment_payroll();
