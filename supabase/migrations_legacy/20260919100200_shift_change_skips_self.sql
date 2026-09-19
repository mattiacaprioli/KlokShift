-- Chi modifica un turno non si avvisa da sé, e non si richiede la conferma.
--
-- `notify_on_shift_change` (20260915100000) fa due cose a chi è assegnato
-- quando data od orari cambiano: gli manda «Turno modificato» e gli riporta lo
-- stato a `'assigned'`, perché la conferma che aveva dato valeva per un turno
-- che non esiste più. Entrambe giuste — verso gli **altri**.
--
-- Da quando chi gestisce la sede può mettersi in turno (20260919100000) il
-- destinatario può essere chi ha appena premuto Salva. Il risultato era:
--
--   · una notifica (e da M7 una push) che dice a uno l'orario che ha scritto lui;
--   · il proprio turno che torna «da confermare», con nessuna schermata dal lato
--     gestione da cui confermarlo — e per un titolare nessun altro che possa
--     farlo al posto suo.
--
-- La prima metà della regola esiste già altrove: `notify_on_assignment` e
-- `notify_on_assignment_removed` saltano chi coincide con `auth.uid()`. Qui si
-- applica lo stesso criterio alle due scritture.
--
-- ⚠️ `auth.uid()` nullo (service role, editor SQL) non esclude nessuno: è il
-- comportamento di prima, e una correzione fatta a mano deve continuare ad
-- avvisare tutti.
--
-- ⚠️ Il ramo «Conferma richiesta» non cambia: già tocca solo le righe con
-- `confirmed_at` nullo, e chi si è messo in turno da sé ce l'ha valorizzato
-- (`default_assignment_confirmation`).
--
-- ⚠️ Prerequisiti: 20260915100000. Indipendente da 20260919100000, ma senza
-- quella non ha occasioni per servire.

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
  elsif new.status <> 'cancelled'
        and (old.date, old.start_time, old.end_time)
            is distinct from (new.date, new.start_time, new.end_time)
  then
    v_type  := 'shift_updated';
    v_title := 'Turno modificato';
  elsif new.status <> 'cancelled'
        and new.require_confirmation and not old.require_confirmation
  then
    -- Il titolare ha acceso «richiedi conferma» su un turno già assegnato.
    v_type  := 'shift_updated';
    v_title := 'Conferma richiesta';
  else
    return new;
  end if;

  select name into v_venue from public.venues where id = new.venue_id;

  if v_type = 'shift_cancelled' then
    v_body := coalesce(v_venue, 'Un locale') || ' ha annullato «' || new.title
      || '» del ' || to_char(new.date, 'DD/MM');
  elsif v_title = 'Conferma richiesta' then
    v_body := coalesce(v_venue, 'Un locale') || ' chiede la conferma per «'
      || new.title || '» del ' || to_char(new.date, 'DD/MM');

    -- Solo chi non ha mai confermato di persona (`confirmed_at` null: i fissi
    -- confermati d'ufficio alla creazione). Chi aveva già detto sì non deve
    -- ridirlo perché è cambiata una regola del turno, non il turno.
    if public.shift_ends_at(new.date, new.start_time, new.end_time) > public.local_now() then
      update public.shift_assignments
         set status = 'assigned'
       where shift_id = new.id
         and status = 'confirmed'
         and confirmed_at is null;
    end if;
  else
    v_body := coalesce(v_venue, 'Un locale') || ' ha modificato «' || new.title
      || '»: ora ' || to_char(new.date, 'DD/MM') || ' · '
      || to_char(new.start_time, 'HH24:MI') || '–' || to_char(new.end_time, 'HH24:MI');

    -- La conferma torna da capo, per tutti **tranne chi sta modificando**: il
    -- suo sì non è scaduto, l'orario nuovo l'ha scritto lui. Solo se il turno
    -- nuovo non è già concluso — correggere a posteriori l'orario di un turno
    -- lavorato non deve riaprire niente (e `freeze_assignment_payroll` lo
    -- rifiuterebbe comunque).
    -- `positions_filled` non si muove: 'assigned' e 'confirmed' contano uguale
    -- (sync_internal_positions_filled, 20260715130000).
    if public.shift_ends_at(new.date, new.start_time, new.end_time) > public.local_now() then
      update public.shift_assignments
         set status = 'assigned'
       where shift_id = new.id
         and status = 'confirmed'
         and staff_member_id not in (select public.my_staff_member_ids());
    end if;
  end if;

  -- Un solo INSERT invece di due loop. `union` (non `union all`) copre il caso
  -- della stessa persona sia assegnata sia candidata accettata.
  --
  -- ⚠️ `is distinct from` e non `<>`: con `auth.uid()` nullo `<>` darebbe null e
  -- la riga uscirebbe dal risultato, cioè **nessuno** riceverebbe la notifica.
  insert into public.notifications (user_id, type, title, body, related_id)
  select w, v_type, v_title, v_body, new.id
  from (
    select sm.waiter_id as w
    from public.shift_assignments a
    join public.staff_members sm on sm.id = a.staff_member_id
    where a.shift_id = new.id
      and a.status in ('assigned', 'confirmed')
      and sm.waiter_id is not null
      and sm.waiter_id is distinct from (select auth.uid())
    union
    select ap.waiter_id
    from public.applications ap
    where ap.shift_id = new.id
      and ap.status = 'accepted'
  ) recipients;

  return new;
end;
$$;

revoke execute on function public.notify_on_shift_change()
  from anon, authenticated, public;
