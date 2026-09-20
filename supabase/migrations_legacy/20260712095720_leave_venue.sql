-- Il cameriere si toglie da solo dall'organico di un locale (si dimette).
-- DEFINER: la RLS di staff_members non concede DELETE al cameriere, e per avvisare
-- il ristoratore serve inserire una notifica cross-user. Riusa il type 'staff_response'.
-- NB: elimina la riga staff_members → cascata sulle sue shift_assignments di quel locale.
create or replace function public.leave_venue(p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter   uuid;
  v_venue_id uuid;
  v_owner    uuid;
  v_name     text;
begin
  select waiter_id, venue_id, display_name
    into v_waiter, v_venue_id, v_name
    from public.staff_members
    where id = p_staff_id and link_status = 'active';

  if v_waiter is null or v_waiter <> (select auth.uid()) then
    raise exception 'not allowed';
  end if;

  select owner_id into v_owner from public.venues where id = v_venue_id;

  delete from public.staff_members where id = p_staff_id;

  if v_owner is not null then
    insert into public.notifications (user_id, type, title, body, related_id)
    values (
      v_owner,
      'staff_response',
      'Un membro ha lasciato lo staff',
      coalesce(v_name, 'Un cameriere') || ' non fa più parte del tuo staff',
      v_venue_id
    );
  end if;
end;
$$;

revoke execute on function public.leave_venue(uuid) from anon, public;
grant execute on function public.leave_venue(uuid) to authenticated;
