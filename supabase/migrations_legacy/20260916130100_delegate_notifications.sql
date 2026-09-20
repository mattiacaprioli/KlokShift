-- Le notifiche arrivano anche a chi gestisce, non solo a chi possiede.
--
-- Tutti i trigger che avvisano il locale scrivono a `venues.owner_id`. Per un
-- collaboratore questo vuol dire che le cose succedono e lui non lo sa: qualcuno
-- rifiuta un turno di stasera, qualcuno esce dall'organico, e la campanella di
-- chi organizza resta muta mentre suona quella del titolare, che magari è in
-- ferie.
--
-- ⚠️ Prerequisito: 20260916130000.

-- ---------------------------------------------------------------------------
-- 1. Un destinatario diventa un elenco
-- ---------------------------------------------------------------------------
-- Una funzione sola invece di ripetere l'union in ogni trigger: il giorno in cui
-- cambia chi ha diritto a sapere, cambia qui. Stessa ragione per cui esiste
-- `my_venue_ids`.
--
-- Non usa `my_venue_ids`: quella risponde su `auth.uid()`, e un trigger deve
-- sapere chi avvisare **di quella sede**, non chi sta scrivendo.
--
-- `p_exclude` è chi ha appena fatto il gesto: nessuno si notifica da solo.
--
-- Le preferenze di notifica non si guardano qui. Le applica già il dispatch
-- (20260716120000) a valle di `notification_category()`, e duplicarne la regola
-- vorrebbe dire due posti in cui un utente può risultare silenziato.
create or replace function public.notify_venue_managers(
  p_venue   uuid,
  p_perm    text,
  p_type    public.notification_type,
  p_title   text,
  p_body    text,
  p_related uuid,
  p_exclude uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, type, title, body, related_id)
  select t.u, p_type, p_title, p_body, p_related
    from (
      select v.owner_id as u
        from public.venues v
       where v.id = p_venue
      union
      select a.user_id
        from public.venue_access a
       where a.venue_id = p_venue
         and a.status   = 'active'
         and a.user_id is not null
         and case p_perm
               when 'shifts' then a.can_manage_shifts
               when 'staff'  then a.can_manage_staff
               when 'hours'  then a.can_view_hours
               else false
             end
    ) t
   where t.u is not null
     and (p_exclude is null or t.u <> p_exclude);
$$;

revoke execute on function
  public.notify_venue_managers(uuid, text, public.notification_type, text, text, uuid, uuid)
  from anon, authenticated, public;

comment on function
  public.notify_venue_managers(uuid, text, public.notification_type, text, text, uuid, uuid) is
  'Avvisa chi gestisce una sede: il titolare più i collaboratori attivi con quel permesso. Unica definizione di "chi ha diritto a saperlo".';

-- ---------------------------------------------------------------------------
-- 2. Il professionista risponde all'invito
-- ---------------------------------------------------------------------------
-- Identica a 20260712093018 salvo il destinatario.
create or replace function public.respond_to_staff_invite(
  p_staff_id uuid,
  p_accept   boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter   uuid;
  v_venue_id uuid;
  v_name     text;
begin
  select waiter_id, venue_id, display_name
    into v_waiter, v_venue_id, v_name
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

  perform public.notify_venue_managers(
    v_venue_id,
    'staff',
    'staff_response',
    case when p_accept then 'Richiesta accettata' else 'Richiesta rifiutata' end,
    coalesce(v_name, 'Un professionista')
      || case when p_accept then ' è entrato nel tuo staff'
              else ' ha rifiutato di entrare nel tuo staff' end,
    v_venue_id
  );
end;
$$;

revoke execute on function public.respond_to_staff_invite(uuid, boolean) from anon, public;
grant execute on function public.respond_to_staff_invite(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Il professionista esce da una sede
-- ---------------------------------------------------------------------------
-- Identica a 20260914103531 salvo il destinatario. ⚠️ `set_config('app.staff_exit')`
-- resta: è quello che silenzia le notifiche di disassegnazione dei turni tolti
-- qui sotto, che altrimenti arriverebbero una per turno.
create or replace function public.leave_venue(p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter   uuid;
  v_venue_id uuid;
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

  perform public.notify_venue_managers(
    v_venue_id,
    'staff',
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
end;
$$;

revoke execute on function public.leave_venue(uuid) from anon, public;
grant execute on function public.leave_venue(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Un turno rifiutato
-- ---------------------------------------------------------------------------
-- È la notifica che conta di più per chi organizza: un buco stasera. Identica a
-- 20260915120000 salvo il destinatario.
--
-- `p_exclude = auth.uid()` sostituisce il vecchio `v_owner = auth.uid() → return`:
-- prima chi segnava il rifiuto dal pannello del turno era per forza il titolare,
-- ora può essere un collaboratore, e a non ricevere la notifica dev'essere chi ha
-- scritto — non il titolare a prescindere.
create or replace function public.notify_on_assignment_declined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue uuid;
  v_date  date;
  v_name  text;
begin
  if new.status <> 'declined' or old.status = 'declined' then
    return new;
  end if;

  select s.venue_id, s.date
    into v_venue, v_date
    from public.shifts s
   where s.id = new.shift_id;

  if v_venue is null then
    return new;
  end if;

  select sm.display_name into v_name
    from public.staff_members sm where sm.id = new.staff_member_id;

  perform public.notify_venue_managers(
    v_venue,
    'shifts',
    'shift_declined',
    'Turno rifiutato',
    coalesce(v_name, 'Un professionista') || ' ha rifiutato il turno del '
      || to_char(v_date, 'DD/MM'),
    new.shift_id,
    (select auth.uid())
  );

  return new;
end;
$$;

revoke execute on function public.notify_on_assignment_declined()
  from anon, authenticated, public;

drop trigger if exists shift_assignments_notify_declined on public.shift_assignments;
create trigger shift_assignments_notify_declined
  after update of status on public.shift_assignments
  for each row execute function public.notify_on_assignment_declined();

-- ---------------------------------------------------------------------------
-- 5. Cosa NON si estende, e perché
-- ---------------------------------------------------------------------------
-- `request_shift_change` (20260915140000) avvisa il titolare con
-- `related_id = <conversazione>`: la richiesta di cambio turno vive come card in
-- chat. La chat è una coppia (professionista, titolare) e non è scopata per sede
-- (20260913100200): un collaboratore quel thread non può aprirlo, e la notifica
-- lo porterebbe su una schermata vuota.
--
-- Non è un buco: `"shift_change_requests: owner read"` (20260916110000) passa da
-- `my_venue_ids('shifts')`, quindi il collaboratore le richieste aperte **le
-- vede** nel pannello del turno, e le chiude con `resolve_shift_change_request`.
-- Gli manca l'avviso, non il lavoro. Si sistema quando la chat diventerà un
-- oggetto della sede — che è una decisione di prodotto, non un refactor.
