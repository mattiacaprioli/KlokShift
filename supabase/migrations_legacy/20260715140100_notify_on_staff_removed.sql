-- Notifica al cameriere quando il ristoratore lo rimuove dallo staff.
-- SECURITY DEFINER (RLS 'notifications: own only' vieta l'insert cross-user dal client).
-- La guardia `waiter_id <> auth.uid()` evita di notificare quando è il cameriere
-- stesso a togliersi (leave_venue, che elimina la riga come waiter). Solo membri
-- attivi con account collegato.
create or replace function public.notify_on_staff_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue text;
begin
  if old.link_status = 'active'
     and old.waiter_id is not null
     and old.waiter_id is distinct from (select auth.uid())
  then
    select name into v_venue from public.venues where id = old.venue_id;
    insert into public.notifications (user_id, type, title, body, related_id)
    values (
      old.waiter_id,
      'staff_removed',
      'Collaborazione terminata',
      coalesce(v_venue, 'Un locale') || ' ti ha rimosso dal suo staff',
      null
    );
  end if;
  return old;
end;
$$;

drop trigger if exists staff_members_notify_removed on public.staff_members;
create trigger staff_members_notify_removed
  after delete on public.staff_members
  for each row execute function public.notify_on_staff_removed();

revoke execute on function public.notify_on_staff_removed() from anon, authenticated, public;
