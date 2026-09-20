-- Una uscita dall'organico, una notifica.
--
-- `notify_on_assignment_removed` (20260909193312) si reggeva su un effetto
-- collaterale, scritto nel suo stesso commento: «cascade da staff_members
-- (rimozione dallo staff / dimissioni) → coperto da notify_on_staff_removed,
-- qui si esce». Funzionava perché la riga padre era **già cancellata** quando il
-- trigger girava, e la select su `staff_members` non trovava più il waiter.
--
-- Da 20260914102811 quella riga non viene più cancellata: resta, con
-- `link_status = 'left'`. Quindi la guardia non scatta più, e togliere dallo
-- staff una persona con sedici turni in programma le manda **sedici** «Turno
-- revocato» — più altrettanti push — oltre all'unica notifica che serve
-- davvero, quella che dice che la collaborazione è finita e quanti turni sono
-- saltati. Visto su dati veri, in una transazione poi annullata.
--
-- L'appiglio implicito diventa esplicito: le due RPC dell'uscita alzano un
-- flag di transazione, e il trigger lo rispetta. `set_config(..., true)` è
-- locale alla transazione, quindi non c'è niente da riabbassare — e se la
-- transazione fallisce il flag se ne va con lei.

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
  -- Uscita dall'organico in corso: la notizia è una sola e la dà chi ha alzato
  -- il flag (`leave_venue` / `remove_staff_member`), con il conto dei turni.
  if coalesce(current_setting('app.staff_exit', true), '') = '1' then
    return old;
  end if;

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

  -- È il professionista stesso ad aver innescato la cancellazione: niente
  -- auto-notifica.
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

  -- related_id resta null di proposito: il professionista ha appena perso il
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

revoke execute on function public.notify_on_assignment_removed()
  from anon, authenticated, public;

-- Le due RPC dell'uscita: identiche a 20260914102811, più la riga che alza il
-- flag prima di toccare le assegnazioni.
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
  v_future   int;
begin
  select waiter_id, venue_id, display_name
    into v_waiter, v_venue_id, v_name
    from public.staff_members
    where id = p_staff_id and link_status = 'active';

  if v_waiter is null or v_waiter <> (select auth.uid()) then
    raise exception 'not allowed';
  end if;

  select owner_id into v_owner from public.venues where id = v_venue_id;

  perform set_config('app.staff_exit', '1', true);

  with gone as (
    delete from public.shift_assignments a
     using public.shifts s
     where a.staff_member_id = p_staff_id
       and s.id = a.shift_id
       and public.shift_ends_at(s.date, s.start_time, s.end_time) > public.local_now()
    returning 1
  )
  select count(*) into v_future from gone;

  update public.staff_members
     set link_status = 'left',
         left_at = now()
   where id = p_staff_id;

  if v_owner is not null then
    insert into public.notifications (user_id, type, title, body, related_id)
    values (
      v_owner,
      'staff_response',
      'Un membro ha lasciato lo staff',
      coalesce(v_name, 'Un professionista') || ' non fa più parte del tuo staff'
        || case
             when v_future = 1 then ' · 1 turno resta da coprire'
             when v_future > 1 then ' · ' || v_future || ' turni restano da coprire'
             else ''
           end,
      v_venue_id
    );
  end if;
end;
$$;

revoke execute on function public.leave_venue(uuid) from anon, public;
grant execute on function public.leave_venue(uuid) to authenticated;

create or replace function public.remove_staff_member(p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter   uuid;
  v_venue_id uuid;
  v_owner    uuid;
  v_venue    text;
  v_future   int;
begin
  select sm.waiter_id, sm.venue_id, v.owner_id, v.name
    into v_waiter, v_venue_id, v_owner, v_venue
    from public.staff_members sm
    join public.venues v on v.id = sm.venue_id
   where sm.id = p_staff_id and sm.link_status <> 'left';

  if v_owner is null or v_owner <> (select auth.uid()) then
    raise exception 'not allowed';
  end if;

  perform set_config('app.staff_exit', '1', true);

  with gone as (
    delete from public.shift_assignments a
     using public.shifts s
     where a.staff_member_id = p_staff_id
       and s.id = a.shift_id
       and public.shift_ends_at(s.date, s.start_time, s.end_time) > public.local_now()
    returning 1
  )
  select count(*) into v_future from gone;

  update public.staff_members
     set link_status = 'left',
         left_at = now()
   where id = p_staff_id;

  -- Chi non ha un account non riceve niente: non c'è nessuno a cui arrivare.
  if v_waiter is not null then
    insert into public.notifications (user_id, type, title, body, related_id)
    values (
      v_waiter,
      'staff_removed',
      'Collaborazione terminata',
      coalesce(v_venue, 'Un locale') || ' ti ha rimosso dal suo staff'
        || case
             when v_future = 1 then ' · 1 turno assegnato è stato annullato'
             when v_future > 1 then ' · ' || v_future || ' turni assegnati sono stati annullati'
             else ''
           end,
      null
    );
  end if;
end;
$$;

revoke execute on function public.remove_staff_member(uuid) from anon, public;
grant execute on function public.remove_staff_member(uuid) to authenticated;
