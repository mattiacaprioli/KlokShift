-- Le due uscite dall'organico, riscritte: si cambia stato, non si cancella.
-- Vedi il perché in 20260914102131, che aggiunge `'left'` e `left_at`.
--
-- Regola comune ai due versi (il professionista che si dimette, il titolare che
-- lo toglie):
--
--   · i turni **passati** restano intatti — ore, presenze, export;
--   · i turni **futuri** (e quello in corso) vengono tolti, perché nessuno li
--     coprirà, e vengono **contati**: la notifica dice quanti, così il buco si
--     vede subito invece di scoprirlo la sera del turno;
--   · l'appartenenza resta come riga, con `link_status = 'left'`;
--   · la persona (`staff_people`) resta, quindi restano i suoi documenti: il
--     trigger degli orfani scatta solo sui delete veri.
--
-- Rientro: il titolare riaggiunge la persona a quella sede e la stessa riga
-- torna 'active' (vedi `addPersonToVenue`/`addStaffToVenues` nel client, che
-- rianimano invece di inserire — l'unique `staff_members_venue_person_uq` non
-- permetterebbe una seconda riga). Lo storico non si spezza.

-- ---------------------------------------------------------------------------
-- 1) Il professionista si dimette
-- ---------------------------------------------------------------------------
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

  -- `shift_ends_at` + `local_now` e non `current_date`: il turno di stanotte è
  -- ancora in corso all'una, e il server ragiona in UTC (20260912090000).
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

comment on function public.leave_venue(uuid) is
  'Il professionista esce dallo staff di una sede: link_status = ''left'', turni futuri tolti e contati, storico e ore intatti.';

-- ---------------------------------------------------------------------------
-- 2) Il titolare toglie qualcuno dall'organico
-- ---------------------------------------------------------------------------
-- Era un `delete` dal client (`removeStaffMember`), con la notifica appesa al
-- trigger `staff_members_notify_removed`. Ora è una RPC: il soft-delete deve
-- fare le stesse tre cose del verso opposto, e un update non farebbe scattare
-- quel trigger (che resta, per i delete veri che sopravvivono).
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

comment on function public.remove_staff_member(uuid) is
  'Il titolare toglie una persona dall''organico di una sede: link_status = ''left'', turni futuri annullati e contati, storico e ore intatti.';

-- ---------------------------------------------------------------------------
-- 3) Il delete vero resta possibile solo dove non c'è niente da perdere
-- ---------------------------------------------------------------------------
-- Senza questo, la RPC di sopra sarebbe una buona maniera e non una garanzia: la
-- policy `"staff_members: owner all"` concede DELETE, e una chiamata REST
-- confezionata a mano (la anon key sta nel client) porterebbe via le ore come
-- prima. Il `for all` si spezza in tre + un DELETE con una condizione in più.
--
-- Il caso che deve continuare a funzionare è quello innocuo: la persona aggiunta
-- per sbaglio, l'invito mai accettato — nessuna assegnazione, quindi niente
-- storico da difendere. Chi ha lavorato anche una sera si archivia, non si
-- cancella.
--
-- La cascata dalla cancellazione della sede non passa dalle policy: continua a
-- funzionare com'è.
drop policy if exists "staff_members: owner all" on public.staff_members;

create policy "staff_members: owner read"
  on public.staff_members for select
  to authenticated
  using (
    exists (
      select 1 from public.venues v
       where v.id = staff_members.venue_id and v.owner_id = (select auth.uid())
    )
  );

create policy "staff_members: owner insert"
  on public.staff_members for insert
  to authenticated
  with check (
    exists (
      select 1
        from public.venues v
        join public.staff_people p on p.owner_id = v.owner_id
       where v.id = staff_members.venue_id
         and p.id = staff_members.person_id
         and v.owner_id = (select auth.uid())
    )
  );

create policy "staff_members: owner update"
  on public.staff_members for update
  to authenticated
  using (
    exists (
      select 1 from public.venues v
       where v.id = staff_members.venue_id and v.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.venues v
        join public.staff_people p on p.owner_id = v.owner_id
       where v.id = staff_members.venue_id
         and p.id = staff_members.person_id
         and v.owner_id = (select auth.uid())
    )
  );

create policy "staff_members: owner delete if never worked"
  on public.staff_members for delete
  to authenticated
  using (
    exists (
      select 1 from public.venues v
       where v.id = staff_members.venue_id and v.owner_id = (select auth.uid())
    )
    and not exists (
      select 1 from public.shift_assignments a
       where a.staff_member_id = staff_members.id
    )
  );
