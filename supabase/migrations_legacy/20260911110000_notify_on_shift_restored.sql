-- Ripristino di un turno annullato.
--
-- Da quando la dashboard permette di riportare un turno da `cancelled` a
-- `open`, la notifica «Turno annullato» poteva restare l'ultima parola: il
-- turno ricompariva nell'agenda del professionista (la RLS lo rende di nuovo
-- leggibile) senza che nessuno glielo dicesse.
--
-- Terzo ramo in `notify_on_shift_change` (20260910120300), stessi destinatari e
-- stesso singolo INSERT degli altri due. Il tipo resta `shift_updated`: il
-- client lo sa già instradare e mostrare, un valore nuovo nell'enum non
-- aggiungerebbe nulla.
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
  elsif old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    v_type  := 'shift_updated';
    v_title := 'Turno ripristinato';
  elsif new.status <> 'cancelled'
        and (old.date, old.start_time, old.end_time)
            is distinct from (new.date, new.start_time, new.end_time)
  then
    v_type  := 'shift_updated';
    v_title := 'Turno modificato';
  else
    return new;
  end if;

  select name into v_venue from public.venues where id = new.venue_id;

  if v_type = 'shift_cancelled' then
    v_body := coalesce(v_venue, 'Un locale') || ' ha annullato «' || new.title
      || '» del ' || to_char(new.date, 'DD/MM');
  elsif v_title = 'Turno ripristinato' then
    v_body := coalesce(v_venue, 'Un locale') || ' ha ripristinato «' || new.title
      || '» del ' || to_char(new.date, 'DD/MM') || ' · '
      || to_char(new.start_time, 'HH24:MI') || '–' || to_char(new.end_time, 'HH24:MI');
  else
    v_body := coalesce(v_venue, 'Un locale') || ' ha modificato «' || new.title
      || '»: ora ' || to_char(new.date, 'DD/MM') || ' · '
      || to_char(new.start_time, 'HH24:MI') || '–' || to_char(new.end_time, 'HH24:MI');
  end if;

  -- Un solo INSERT invece di due loop. `union` (non `union all`) copre il caso
  -- della stessa persona sia assegnata sia candidata accettata: prima avrebbe
  -- ricevuto due notifiche identiche.
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

drop trigger if exists shifts_notify_change on public.shifts;
create trigger shifts_notify_change
  after update on public.shifts
  for each row execute function public.notify_on_shift_change();
