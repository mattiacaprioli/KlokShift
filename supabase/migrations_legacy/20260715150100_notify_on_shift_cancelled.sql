-- Notifica ai camerieri coinvolti quando un turno viene annullato: senza questa,
-- il turno sparisce dalle loro viste (RLS "waiter reads non-cancelled") senza
-- alcun avviso. Destinatari: staff assegnato non-rifiutato (turni interni, se
-- collegato a un account) + candidati accettati (marketplace).
-- SECURITY DEFINER: la RLS 'notifications: own only' vieta l'insert cross-user.
create or replace function public.notify_on_shift_cancelled()
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
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    select name into v_venue from public.venues where id = new.venue_id;
    v_body := coalesce(v_venue, 'Un locale') || ' ha annullato «' || new.title
      || '» del ' || to_char(new.date, 'DD/MM');

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
      values (r.waiter_id, 'shift_cancelled', 'Turno annullato', v_body, new.id);
    end loop;

    -- Marketplace: candidati accettati.
    for r in
      select ap.waiter_id
      from public.applications ap
      where ap.shift_id = new.id and ap.status = 'accepted'
    loop
      insert into public.notifications (user_id, type, title, body, related_id)
      values (r.waiter_id, 'shift_cancelled', 'Turno annullato', v_body, new.id);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists shifts_notify_cancelled on public.shifts;
create trigger shifts_notify_cancelled
  after update on public.shifts
  for each row execute function public.notify_on_shift_cancelled();

revoke execute on function public.notify_on_shift_cancelled()
  from anon, authenticated, public;
