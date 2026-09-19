-- 1) Realtime sui dati dei turni/organico, così le due parti (ristoratore/cameriere)
-- vedono i cambiamenti in tempo reale senza ricaricare. Idempotente: le tabelle
-- potrebbero già essere nella publication.
do $$
declare
  t text;
begin
  foreach t in array array['shifts', 'shift_assignments', 'staff_members'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 2) Il ristoratore riceve una notifica quando il cameriere accetta/rifiuta
-- l'invito. Aggiungo l'insert dentro la funzione DEFINER esistente.
create or replace function public.respond_to_staff_invite(p_staff_id uuid, p_accept boolean)
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
    where id = p_staff_id and link_status = 'pending';

  if v_waiter is null or v_waiter <> (select auth.uid()) then
    raise exception 'not allowed';
  end if;

  select owner_id into v_owner from public.venues where id = v_venue_id;

  if p_accept then
    update public.staff_members set link_status = 'active' where id = p_staff_id;
  else
    delete from public.staff_members where id = p_staff_id;
  end if;

  if v_owner is not null then
    insert into public.notifications (user_id, type, title, body, related_id)
    values (
      v_owner,
      'staff_response',
      case when p_accept then 'Richiesta accettata' else 'Richiesta rifiutata' end,
      coalesce(v_name, 'Un cameriere')
        || case when p_accept then ' è entrato nel tuo staff'
                else ' ha rifiutato di entrare nel tuo staff' end,
      v_venue_id
    );
  end if;
end;
$$;

revoke execute on function public.respond_to_staff_invite(uuid, boolean) from anon, public;
grant execute on function public.respond_to_staff_invite(uuid, boolean) to authenticated;
