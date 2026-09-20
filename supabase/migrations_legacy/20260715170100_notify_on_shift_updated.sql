-- Notifica ai camerieri coinvolti quando giorno/orario di un turno cambiano
-- (proposta utente: chi ha confermato per le 19:00 deve sapere se si sposta).
-- Speculare a notify_on_shift_cancelled: destinatari = staff assegnato attivo
-- (turni interni, se collegato) + candidati accettati (marketplace).
-- Nessun reset automatico delle conferme: il cameriere può rifiutare dal dettaglio.
create or replace function public.notify_on_shift_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue text;
  v_body  text;
  r record;
begin
  if new.status <> 'cancelled'
     and (old.date, old.start_time, old.end_time)
         is distinct from (new.date, new.start_time, new.end_time)
  then
    select name into v_venue from public.venues where id = new.venue_id;
    v_body := coalesce(v_venue, 'Un locale') || ' ha modificato «' || new.title
      || '»: ora ' || to_char(new.date, 'DD/MM') || ' · '
      || to_char(new.start_time, 'HH24:MI') || '–' || to_char(new.end_time, 'HH24:MI');

    -- Turni interni: staff assegnato (assegnato/confermato) con account collegato.
    for r in
      select sm.waiter_id
      from public.shift_assignments a
      join public.staff_members sm on sm.id = a.staff_member_id
      where a.shift_id = new.id
        and a.status in ('assigned', 'confirmed')
        and sm.waiter_id is not null
    loop
      insert into public.notifications (user_id, type, title, body, related_id)
      values (r.waiter_id, 'shift_updated', 'Turno modificato', v_body, new.id);
    end loop;

    -- Marketplace: candidati accettati.
    for r in
      select ap.waiter_id
      from public.applications ap
      where ap.shift_id = new.id and ap.status = 'accepted'
    loop
      insert into public.notifications (user_id, type, title, body, related_id)
      values (r.waiter_id, 'shift_updated', 'Turno modificato', v_body, new.id);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists shifts_notify_updated on public.shifts;
create trigger shifts_notify_updated
  after update on public.shifts
  for each row execute function public.notify_on_shift_updated();

revoke execute on function public.notify_on_shift_updated()
  from anon, authenticated, public;
