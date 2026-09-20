-- Spostare una PERSONA da un turno a un altro.
--
-- Fino a qui il planning sapeva fare due gesti: spostare un turno nel tempo
-- (`update_shift` con una data diversa — si muove tutta la squadra) e passarlo
-- di mano nello stesso giorno (`reassign`). Mancava il terzo, che è quello che
-- la vista per persona suggerisce a colpo d'occhio: «Marco giovedì invece che
-- mercoledì», senza toccare i colleghi che mercoledì restano.
--
-- È `reassign` ribaltata: lì cambia la persona e resta il turno, qui resta la
-- persona e cambia il turno. Stessa meccanica — delete + `private.assign_one`
-- nella stessa transazione — perché è l'unica che fa partire da sola sia
-- «Turno revocato» sia «Nuovo turno assegnato», e perché chi arriva non deve
-- ereditare la conferma (né le ore) che aveva sul turno di partenza.

-- p_to_shift: un turno che esiste già quel giorno.
-- p_to_date:  non c'è niente dove metterla, e allora si fa il gemello del turno
--             di partenza su quella data. Uno dei due, mai entrambi.
create function public.move_assignment(
  p_assignment uuid,
  p_to_shift   uuid default null,
  p_to_date    date default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  a           record;
  v_from      record;
  v_to_venue  uuid;
  v_to_member uuid;
  v_to_shift  uuid;
  v_role      uuid;
begin
  if (p_to_shift is null) = (p_to_date is null) then
    raise exception 'invalid_target' using errcode = '23514';
  end if;

  select x.shift_id, x.venue_member_id, x.role_id, vm.member_id
    into a
    from public.shift_assignments x
    join public.venue_members vm on vm.id = x.venue_member_id
   where x.id = p_assignment;
  if a.shift_id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.assert_can_touch_assignment(a.shift_id, a.venue_member_id);

  select s.venue_id, s.title, s.description, s.start_time, s.end_time, s.require_confirmation
    into v_from
    from public.shifts s where s.id = a.shift_id;

  if p_to_shift is not null then
    -- Già sul turno di arrivo: niente da fare, e soprattutto niente notifiche.
    if p_to_shift = a.shift_id then
      return p_assignment;
    end if;
    select s.venue_id into v_to_venue from public.shifts s where s.id = p_to_shift;
    if v_to_venue is null then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    v_to_shift := p_to_shift;
  else
    -- Il gemello nasce nella sede del turno di partenza: `update_shift` non
    -- sposta mai un turno di sede, e questo non è il posto per cominciare.
    v_to_venue := v_from.venue_id;
  end if;

  -- La stessa PERSONA nella sede di arrivo. Con una sede sola è la riga di
  -- partenza; con più sedi può essere un'altra scheda di organico, e sceglierla
  -- male produrrebbe un'assegnazione che il database accetta in silenzio.
  select vm.id into v_to_member
    from public.venue_members vm
    join public.workspace_members m on m.id = vm.member_id
   where vm.member_id = a.member_id and vm.venue_id = v_to_venue
     and vm.left_at is null and m.status = 'active';
  if v_to_member is null then
    raise exception 'not_in_roster' using errcode = '23514';
  end if;

  -- La mansione viaggia, come in `reassign`: la stessa se in quella sede esiste
  -- ed è sua, altrimenti la sua unica mansione, altrimenti nessuna.
  select r.role_id into v_role from public.venue_member_roles r
   where r.venue_member_id = v_to_member and r.role_id = a.role_id;
  if v_role is null then
    select (array_agg(r.role_id))[1] into v_role from public.venue_member_roles r
     where r.venue_member_id = v_to_member
    having count(*) = 1;
  end if;

  if v_to_shift is null then
    if not private.can(v_to_venue, 'shifts') then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    insert into public.shifts (
      venue_id, title, description, date, start_time, end_time, require_confirmation, positions_total
    ) values (
      v_to_venue, v_from.title, v_from.description,
      p_to_date, v_from.start_time, v_from.end_time, v_from.require_confirmation,
      private.positions_for(null::jsonb, 1)
    ) returning id into v_to_shift;
  end if;

  perform private.assert_can_touch_assignment(v_to_shift, v_to_member);

  delete from public.shift_assignments where id = p_assignment;
  return private.assign_one(v_to_shift, v_to_member, v_role);
end;
$$;

grant execute on function public.move_assignment(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- `confirmed_at` che resta appeso dopo uno spostamento
-- ---------------------------------------------------------------------------
-- Il reset delle conferme riportava `status` a 'assigned' lasciando
-- `confirmed_at` valorizzato: una conferma che non c'è più, con addosso la data
-- di quando c'era. `respond_assignment` e `record_attendance` lo azzerano già.
-- Sotto è la stessa funzione di `20260920000800_shifts.sql`, con `confirmed_at
-- = null` aggiunto alle due update.
create or replace function public.notify_on_shift_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_venue text;
  v_type  public.notification_type;
  v_title text;
  v_body  text;
  v_user  uuid;
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    v_type := 'shift_cancelled'; v_title := 'Turno annullato';
  elsif new.status <> 'cancelled'
        and (old.date, old.start_time, old.end_time) is distinct from (new.date, new.start_time, new.end_time) then
    v_type := 'shift_updated'; v_title := 'Turno modificato';
  elsif new.status <> 'cancelled' and new.require_confirmation and not old.require_confirmation then
    v_type := 'shift_updated'; v_title := 'Conferma richiesta';
  else
    return new;
  end if;

  select name into v_venue from public.venues where id = new.venue_id;

  if v_type = 'shift_cancelled' then
    v_body := coalesce(v_venue, 'Una sede') || ' ha annullato «' || new.title || '» del ' || to_char(new.date, 'DD/MM');
  elsif v_title = 'Conferma richiesta' then
    v_body := coalesce(v_venue, 'Una sede') || ' chiede la conferma per «' || new.title || '» del ' || to_char(new.date, 'DD/MM');
    -- Solo chi non ha mai confermato di persona: i fissi confermati d'ufficio.
    if public.shift_ends_at(new.date, new.start_time, new.end_time) > public.local_now() then
      update public.shift_assignments set status = 'assigned', confirmed_at = null
       where shift_id = new.id and status = 'confirmed' and confirmed_at is null
         and venue_member_id not in (select private.my_venue_member_ids());
    end if;
  else
    v_body := coalesce(v_venue, 'Una sede') || ' ha modificato «' || new.title || '»: ora '
      || to_char(new.date, 'DD/MM') || ' · ' || to_char(new.start_time, 'HH24:MI') || '–' || to_char(new.end_time, 'HH24:MI');
    if public.shift_ends_at(new.date, new.start_time, new.end_time) > public.local_now() then
      update public.shift_assignments set status = 'assigned', confirmed_at = null
       where shift_id = new.id and status = 'confirmed'
         and venue_member_id not in (select private.my_venue_member_ids());
    end if;
  end if;

  for v_user in
    select distinct m.user_id
      from public.shift_assignments a
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.workspace_members m on m.id = vm.member_id
     where a.shift_id = new.id and a.status in ('assigned', 'confirmed') and m.user_id is not null
  loop
    perform private.notify(v_user, v_type, v_title, v_body, new.id);
  end loop;
  return new;
end;
$$;
