-- Invito di collaborazione: il ristoratore trova un cameriere (per email) e gli
-- manda una richiesta di entrare nel suo organico. Il cameriere accetta/rifiuta.

-- Stato del collegamento in organico: 'active' = confermato (default: schede
-- manuali, link da storico, righe esistenti); 'pending' = invito da accettare.
create type public.staff_link_status as enum ('pending', 'active');
alter table public.staff_members
  add column link_status public.staff_link_status not null default 'active';

-- Lookup di un cameriere per email esatta. L'email vive in auth.users (non nei
-- profili pubblici) → serve SECURITY DEFINER. Ritorna solo dati non sensibili e
-- solo se il chiamante è un ristoratore.
-- NB: l'advisor 0029 segnala (WARN) che è una DEFINER eseguibile da authenticated:
-- è intenzionale (RPC di ricerca ristretta ai ristoratori).
create or replace function public.find_waiter_by_email(p_email text)
returns table (id uuid, full_name text, avatar_url text, city text)
language sql
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.avatar_url, p.city
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(u.email) = lower(trim(p_email))
    and p.role = 'waiter'
    and exists (
      select 1 from public.profiles me
      where me.id = (select auth.uid()) and me.role = 'manager'
    )
  limit 1;
$$;

revoke execute on function public.find_waiter_by_email(text) from anon, public;
grant execute on function public.find_waiter_by_email(text) to authenticated;

-- Il cameriere accetta (pending -> active) o rifiuta (elimina la riga) un invito.
-- DEFINER per non aprire policy di UPDATE/DELETE larghe su staff_members.
create or replace function public.respond_to_staff_invite(p_staff_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter uuid;
begin
  select waiter_id into v_waiter
    from public.staff_members
    where id = p_staff_id and link_status = 'pending';

  if v_waiter is null or v_waiter <> (select auth.uid()) then
    raise exception 'not allowed';
  end if;

  if p_accept then
    update public.staff_members set link_status = 'active' where id = p_staff_id;
  else
    delete from public.staff_members where id = p_staff_id;
  end if;
end;
$$;

revoke execute on function public.respond_to_staff_invite(uuid, boolean) from anon, public;
grant execute on function public.respond_to_staff_invite(uuid, boolean) to authenticated;

-- Notifica al cameriere quando riceve un invito (insert pending con waiter_id).
create or replace function public.notify_on_staff_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue text;
begin
  if new.link_status = 'pending' and new.waiter_id is not null then
    select name into v_venue from public.venues where id = new.venue_id;
    insert into public.notifications (user_id, type, title, body, related_id)
    values (
      new.waiter_id,
      'staff_invite',
      'Richiesta di collaborazione',
      coalesce(v_venue, 'Un locale') || ' vuole aggiungerti al suo staff',
      new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists staff_members_notify_invite on public.staff_members;
create trigger staff_members_notify_invite
  after insert on public.staff_members
  for each row execute function public.notify_on_staff_invite();

revoke execute on function public.notify_on_staff_invite() from anon, authenticated, public;
