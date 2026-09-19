-- Notifica al cameriere quando il ristoratore lo toglie da un turno interno
-- (modifica turno → deseleziona una persona). Senza questa, l'assegnazione
-- sparisce in silenzio: la policy "shifts: read marketplace or assigned" usa
-- is_my_assigned_shift(), quindi nell'istante in cui la riga viene cancellata
-- il cameriere perde anche il permesso di *leggere* il turno — se aveva la
-- schermata aperta vede "Turno non trovato". Stesso buco già chiuso per
-- staff_removed e shift_cancelled.
--
-- Il trigger è AFTER DELETE su una tabella con due FK `on delete cascade`, per
-- cui scatta anche in situazioni che NON sono una rimozione dal turno. Le
-- guardie sotto sfruttano il fatto che in un cascade la riga padre è già stata
-- cancellata quando il trigger gira, quindi la select non la trova più:
--   * cascade da staff_members (rimozione dallo staff / dimissioni) → coperto
--     da notify_on_staff_removed, qui si esce;
--   * cascade da shifts (turno eliminato) → niente da annunciare;
--   * turno annullato → coperto da notify_on_shift_cancelled (doppia notifica).
--
-- SECURITY DEFINER: la RLS 'notifications: own only' vieta l'insert cross-user.
create or replace function public.notify_on_assignment_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter uuid;
  v_venue  text;
  v_date   date;
  v_status public.shift_status;
begin
  -- Aveva già rifiutato: togliergli il turno non è una notizia per lui.
  if old.status = 'declined' then
    return old;
  end if;

  -- Membro dello staff sparito (cascade) o scheda senza account collegato.
  select sm.waiter_id into v_waiter
  from public.staff_members sm
  where sm.id = old.staff_member_id;

  if v_waiter is null then
    return old;
  end if;

  -- È il cameriere stesso ad aver innescato la cancellazione: niente auto-notifica.
  if v_waiter = (select auth.uid()) then
    return old;
  end if;

  -- Il titolo dei turni interni è "Turno · <data>": ridondante nel corpo, si usa
  -- solo la data.
  select v.name, s.date, s.status
    into v_venue, v_date, v_status
  from public.shifts s
  join public.venues v on v.id = s.venue_id
  where s.id = old.shift_id;

  -- Turno cancellato (cascade) o annullato: se ne occupa un altro trigger.
  if not found or v_status = 'cancelled' then
    return old;
  end if;

  -- Turni passati: qui il gestore sta correggendo lo storico, non disdicendo.
  if v_date < current_date then
    return old;
  end if;

  -- related_id resta null di proposito: il cameriere ha appena perso il
  -- permesso di leggere quel turno, quindi la notifica non può puntarci.
  insert into public.notifications (user_id, type, title, body, related_id)
  values (
    v_waiter,
    'shift_unassigned',
    'Turno revocato',
    coalesce(v_venue, 'Un locale') || ' ti ha tolto dal turno del '
      || to_char(v_date, 'DD/MM'),
    null
  );

  return old;
end;
$$;

drop trigger if exists shift_assignments_notify_removed on public.shift_assignments;
create trigger shift_assignments_notify_removed
  after delete on public.shift_assignments
  for each row execute function public.notify_on_assignment_removed();

revoke execute on function public.notify_on_assignment_removed()
  from anon, authenticated, public;
