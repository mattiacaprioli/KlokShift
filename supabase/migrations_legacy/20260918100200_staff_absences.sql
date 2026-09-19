-- Ferie, permessi e malattia (FERIE_MALATTIA.md, fase F1).
--
-- ⚠️ Prerequisito: 20260918100000 e 20260918100100 (valori di enum nuovi) devono
-- essere già applicate. Qui quei valori si usano.
--
-- Perché una tabella nuova e non un `change_request_kind` 'time_off' in più
-- (come ipotizzava il commento di 20260915140000):
--   - `shift_change_requests.shift_id` è `not null`: una richiesta di cambio
--     riguarda un turno. Le ferie riguardano un intervallo di date, e quando si
--     chiedono spesso i turni non esistono ancora.
--   - Approvare un cambio turno riscrive un'assegnazione. Approvare le ferie non
--     tocca nessun turno da solo: chi va tolto dai turni lo decide il titolare,
--     con un'azione esplicita.
-- Dello stesso modello si riusa invece lo **schema**: sola lettura via RLS,
-- scrittura solo da RPC DEFINER, card in chat, notifiche dedicate.
--
-- ⚠️ Malattia = dati sanitari (GDPR art. 9). Si salvano solo le date e, se c'è,
-- il numero di protocollo del certificato telematico INPS. La nota sulla malattia
-- non esiste (check `staff_absences_sick_no_note_ck`), mai diagnosi, mai allegati.

-- ---------------------------------------------------------------------------
-- 1. La tabella
-- ---------------------------------------------------------------------------
create type public.absence_kind as enum ('ferie', 'permesso', 'malattia');
create type public.absence_status as enum ('pending', 'approved', 'rejected', 'withdrawn');

-- L'assenza è della **persona** (staff_people, persona × titolare) e non della
-- sede: chi lavora in due sedi dello stesso titolare chiede le ferie una volta.
create table public.staff_absences (
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid not null references public.staff_people(id) on delete cascade,
  -- Denormalizzato come su staff_people: serve alle RPC e agli indici.
  owner_id        uuid not null references public.profiles(id) on delete cascade,
  kind            public.absence_kind not null,
  start_date      date not null,
  end_date        date not null,
  -- Solo per un permesso a ore, nello stesso giorno.
  start_time      time,
  end_time        time,
  -- Motivo di ferie o permesso. Sempre null per la malattia.
  note            text,
  -- Solo per la malattia. Spesso arriva dopo la visita: si aggiunge dopo.
  inps_protocol   text,
  status          public.absence_status not null default 'pending',
  -- null = registrata dal titolare (malattia comunicata al telefono).
  requested_by    uuid references public.profiles(id) on delete set null,
  resolved_by     uuid references public.profiles(id) on delete set null,
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz not null default now(),

  constraint staff_absences_range_ck check (end_date >= start_date),
  constraint staff_absences_times_pair_ck check ((start_time is null) = (end_time is null)),
  constraint staff_absences_hourly_ck check (
    start_time is null
    or (kind = 'permesso' and start_date = end_date and end_time > start_time)
  ),
  constraint staff_absences_protocol_ck check (kind = 'malattia' or inps_protocol is null),
  constraint staff_absences_sick_no_note_ck check (kind <> 'malattia' or note is null)
);

comment on table public.staff_absences is
  'Ferie, permessi e malattie di una persona dell''organico. Sola lettura: si scrive solo dalle RPC request_absence, resolve_absence, withdraw_absence, record_absence, set_absence_inps_protocol.';

create index staff_absences_person_dates_idx
  on public.staff_absences (person_id, start_date, end_date);
create index staff_absences_owner_status_idx
  on public.staff_absences (owner_id, status, start_date);

-- La card in chat punta all'assenza come `request_id` punta alla richiesta di
-- cambio turno. Colonna a sé: `request_id` è una FK verso shift_change_requests.
alter table public.messages
  add column absence_id uuid references public.staff_absences(id) on delete set null;

create index messages_absence_idx on public.messages (absence_id)
  where absence_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Chi gestisce una persona
-- ---------------------------------------------------------------------------
-- Il titolare, oppure un delegato con il permesso richiesto su almeno una sede
-- dove la persona è in organico (non uscita). Il perimetro dei delegati resta
-- quello di `my_venue_ids` (20260916130000): qui non si riscrive.
create or replace function public.can_manage_person(p_person uuid, p_perm text default 'staff')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_people p
     where p.id = p_person
       and p.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.staff_members sm
     where sm.person_id = p_person
       and sm.link_status <> 'left'
       and sm.venue_id in (select public.my_venue_ids(p_perm))
  );
$$;

revoke execute on function public.can_manage_person(uuid, text) from anon, public;
grant execute on function public.can_manage_person(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. RLS: sola lettura
-- ---------------------------------------------------------------------------
alter table public.staff_absences enable row level security;

create policy "staff_absences: requester read"
  on public.staff_absences for select
  to authenticated
  using (
    exists (
      select 1 from public.staff_people p
       where p.id = staff_absences.person_id
         and p.waiter_id = (select auth.uid())
    )
  );

-- Il tipo di assenza è un dato sanitario quando è 'malattia': lo legge solo chi
-- gestisce la persona ('staff'), non chi fa soltanto i turni.
create policy "staff_absences: manager read"
  on public.staff_absences for select
  to authenticated
  using (public.can_manage_person(staff_absences.person_id, 'staff'));

-- Nessuna policy di insert, update o delete.

-- ---------------------------------------------------------------------------
-- 4. Helper interni
-- ---------------------------------------------------------------------------
-- Controlli di forma con messaggi leggibili: i check della tabella restano la
-- garanzia, ma il loro errore («violates check constraint») non si mostra.
create or replace function public.absence_validate(
  p_kind public.absence_kind,
  p_start date,
  p_end date,
  p_start_time time,
  p_end_time time,
  p_inps_protocol text
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_start is null or p_end is null then
    raise exception 'Indica le date';
  end if;

  if p_end < p_start then
    raise exception 'La data di fine viene prima di quella di inizio';
  end if;

  if (p_start_time is null) <> (p_end_time is null) then
    raise exception 'Indica sia l''ora di inizio sia quella di fine';
  end if;

  if p_start_time is not null then
    if p_kind <> 'permesso' then
      raise exception 'Solo un permesso può essere a ore';
    end if;
    if p_start <> p_end then
      raise exception 'Un permesso a ore vale per un giorno solo';
    end if;
    if p_end_time <= p_start_time then
      raise exception 'L''ora di fine deve venire dopo quella di inizio';
    end if;
  end if;

  if p_kind <> 'malattia' and nullif(btrim(coalesce(p_inps_protocol, '')), '') is not null then
    raise exception 'Il protocollo INPS vale solo per la malattia';
  end if;
end;
$$;

revoke execute on function
  public.absence_validate(public.absence_kind, date, date, time, time, text)
  from anon, authenticated, public;

-- Sovrapposizione con un'altra assenza attiva della stessa persona. Controllo
-- in plpgsql e non un exclusion constraint: due permessi a ore nello stesso
-- giorno sono legittimi, e l'errore deve arrivare in italiano.
create or replace function public.absence_assert_no_overlap(
  p_person uuid,
  p_start date,
  p_end date,
  p_start_time time,
  p_end_time time
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.staff_absences a
     where a.person_id = p_person
       and a.status in ('pending', 'approved')
       and a.start_date <= p_end
       and a.end_date   >= p_start
       and (
         -- Una delle due vale tutto il giorno: si sovrappongono.
         a.start_time is null or p_start_time is null
         -- Entrambe a ore (quindi entrambe nello stesso giorno): orari incrociati.
         or (a.start_time < p_end_time and p_start_time < a.end_time)
       )
  ) then
    raise exception 'C''è già un''assenza in quelle date';
  end if;
end;
$$;

revoke execute on function
  public.absence_assert_no_overlap(uuid, date, date, time, time)
  from anon, authenticated, public;

-- «dal 01/10 al 05/10», «il 01/10», «il 01/10 dalle 09:00 alle 12:00». Usata nel
-- testo delle card e delle notifiche.
create or replace function public.absence_range_label(
  p_start date,
  p_end date,
  p_start_time time,
  p_end_time time
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_start = p_end and p_start_time is not null then
      'il ' || to_char(p_start, 'DD/MM')
        || ' dalle ' || to_char(p_start_time, 'HH24:MI')
        || ' alle '  || to_char(p_end_time, 'HH24:MI')
    when p_start = p_end then 'il ' || to_char(p_start, 'DD/MM')
    else 'dal ' || to_char(p_start, 'DD/MM') || ' al ' || to_char(p_end, 'DD/MM')
  end;
$$;

revoke execute on function public.absence_range_label(date, date, time, time)
  from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 5. Chiedere (o comunicare la malattia)
-- ---------------------------------------------------------------------------
-- Tre cose in una transazione, come request_shift_change: l'assenza, la card nel
-- thread col titolare, la notifica. La malattia non si approva: nasce 'approved'.
--
-- Solo il titolare riceve card e notifica, non i delegati: la conversazione è la
-- coppia (professionista, titolare) e non è per sede (20260916130100). I
-- delegati con 'staff' vedono le richieste in sospeso nella home.
create or replace function public.request_absence(
  p_owner uuid,
  p_kind public.absence_kind,
  p_start date,
  p_end date,
  p_start_time time default null,
  p_end_time time default null,
  p_note text default null,
  p_inps_protocol text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := (select auth.uid());
  v_person   uuid;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_protocol text := nullif(btrim(coalesce(p_inps_protocol, '')), '');
  v_sick     boolean := p_kind = 'malattia';
  v_id       uuid;
  v_conv     uuid;
  v_range    text;
  v_label    text;
  v_name     text;
begin
  perform public.absence_validate(p_kind, p_start, p_end, p_start_time, p_end_time, v_protocol);

  select p.id into v_person
    from public.staff_people p
   where p.owner_id = p_owner
     and p.waiter_id = v_me
     and exists (
       select 1 from public.staff_members sm
        where sm.person_id = p.id and sm.link_status = 'active'
     );

  if v_person is null then
    raise exception 'Non fai parte dell''organico di questa azienda';
  end if;

  -- Ferie e permessi si chiedono prima. La malattia si comunica anche a cose
  -- fatte (il certificato copre i giorni già passati).
  if not v_sick and p_start < public.local_now()::date then
    raise exception 'Non puoi chiedere un''assenza per giorni già passati';
  end if;

  perform public.absence_assert_no_overlap(v_person, p_start, p_end, p_start_time, p_end_time);

  insert into public.staff_absences
    (person_id, owner_id, kind, start_date, end_date, start_time, end_time,
     note, inps_protocol, status, requested_by)
  values
    (v_person, p_owner, p_kind, p_start, p_end, p_start_time, p_end_time,
     case when v_sick then null else v_note end,
     case when v_sick then v_protocol end,
     (case when v_sick then 'approved' else 'pending' end)::public.absence_status,
     v_me)
  returning id into v_id;

  if v_sick then
    update public.staff_absences
       set resolved_at = now()
     where id = v_id;
  end if;

  v_range := public.absence_range_label(p_start, p_end, p_start_time, p_end_time);
  v_label := case p_kind
               when 'ferie'    then 'Ferie'
               when 'permesso' then 'Permesso'
               else 'Malattia'
             end;

  v_conv := public.conversation_for_pair(v_me, p_owner, null);

  -- `content` porta la versione testuale: chi non sa rendere la card (un'app
  -- vecchia, una notifica push) legge comunque la cosa giusta. Mai la nota
  -- sulla malattia, che comunque non esiste.
  insert into public.messages (conversation_id, sender_id, content, kind, absence_id)
  values (
    v_conv, v_me,
    v_label || ' ' || v_range
      || case when not v_sick and v_note is not null then ': ' || v_note else '' end,
    'absence_request', v_id
  );

  v_name := coalesce(
    (select full_name from public.profiles where id = v_me),
    'Un professionista'
  );

  insert into public.notifications (user_id, type, title, body, related_id)
  values (
    p_owner,
    (case when v_sick then 'absence_sick' else 'absence_request' end)::public.notification_type,
    case p_kind
      when 'ferie'    then 'Richiesta di ferie'
      when 'permesso' then 'Richiesta di permesso'
      else 'Malattia comunicata'
    end,
    v_name || case p_kind
                when 'ferie'    then ' chiede le ferie '
                when 'permesso' then ' chiede un permesso '
                else ' è in malattia '
              end || v_range,
    v_conv
  );

  return v_id;
end;
$$;

revoke execute on function
  public.request_absence(uuid, public.absence_kind, date, date, time, time, text, text)
  from anon, public;
grant execute on function
  public.request_absence(uuid, public.absence_kind, date, date, time, time, text, text)
  to authenticated;

comment on function
  public.request_absence(uuid, public.absence_kind, date, date, time, time, text, text) is
  'Il professionista chiede ferie o un permesso (pending) o comunica una malattia (approved) a un titolare di cui è in organico: crea l''assenza, la card nel thread di chat e la notifica.';

-- ---------------------------------------------------------------------------
-- 6. Decidere
-- ---------------------------------------------------------------------------
-- Approvare non toglie nessuno dai turni: lo fa il titolare, a parte.
create or replace function public.resolve_absence(
  p_absence uuid,
  p_approve boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me        uuid := (select auth.uid());
  v_person    uuid;
  v_owner     uuid;
  v_requester uuid;
  v_kind      public.absence_kind;
  v_start     date;
  v_end       date;
  v_st        time;
  v_et        time;
  v_note      text := nullif(btrim(coalesce(p_note, '')), '');
  v_label     text;
  v_content   text;
  v_conv      uuid;
begin
  select a.person_id, a.owner_id, a.requested_by, a.kind,
         a.start_date, a.end_date, a.start_time, a.end_time
    into v_person, v_owner, v_requester, v_kind, v_start, v_end, v_st, v_et
    from public.staff_absences a
   where a.id = p_absence
     and a.status = 'pending';

  if not found then
    raise exception 'Richiesta non trovata o già chiusa';
  end if;

  if not public.can_manage_person(v_person, 'staff') then
    raise exception 'Non sei tu a decidere su questa richiesta';
  end if;

  update public.staff_absences
     set status = (case when p_approve then 'approved' else 'rejected' end)
                  ::public.absence_status,
         resolved_by = v_me,
         resolved_at = now(),
         resolution_note = v_note
   where id = p_absence;

  -- Una richiesta 'pending' ha sempre chi l'ha chiesta: quelle registrate dal
  -- titolare nascono approvate. Il controllo resta per un account cancellato.
  if v_requester is null then
    return;
  end if;

  v_label := case v_kind when 'ferie' then 'Ferie' else 'Permesso' end;
  -- «Ferie» è femminile plurale, «Permesso» maschile singolare.
  v_content := v_label || ' ' || public.absence_range_label(v_start, v_end, v_st, v_et)
    || case when p_approve then ': approvat' else ': rifiutat' end
    || case when v_kind = 'ferie' then 'e.' else 'o.' end;
  if v_note is not null then
    v_content := v_content || ' ' || v_note;
  end if;

  v_conv := public.conversation_for_pair(v_requester, v_owner, null);

  insert into public.messages (conversation_id, sender_id, content, kind, absence_id)
  values (v_conv, v_me, v_content, 'absence_response', p_absence);

  insert into public.notifications (user_id, type, title, body, related_id)
  values (
    v_requester,
    'absence_response',
    case
      when v_kind = 'ferie' and p_approve then 'Ferie approvate'
      when v_kind = 'ferie'               then 'Ferie rifiutate'
      when p_approve                      then 'Permesso approvato'
      else                                     'Permesso rifiutato'
    end,
    v_label || ' ' || public.absence_range_label(v_start, v_end, v_st, v_et),
    v_conv
  );
end;
$$;

revoke execute on function public.resolve_absence(uuid, boolean, text) from anon, public;
grant execute on function public.resolve_absence(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Ritirare
-- ---------------------------------------------------------------------------
-- Da 'pending' sempre; da 'approved' solo se non è ancora cominciata. Ritirare
-- un'assenza già approvata avvisa il titolare, che magari ha già tolto la
-- persona dai turni; ritirare una richiesta in sospeso no (come
-- withdraw_shift_change_request): la card nel thread basta.
create or replace function public.withdraw_absence(p_absence uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me        uuid := (select auth.uid());
  v_owner     uuid;
  v_requester uuid;
  v_status    public.absence_status;
  v_kind      public.absence_kind;
  v_start     date;
  v_end       date;
  v_st        time;
  v_et        time;
  v_range     text;
  v_label     text;
  v_conv      uuid;
begin
  select a.owner_id, a.requested_by, a.status, a.kind,
         a.start_date, a.end_date, a.start_time, a.end_time
    into v_owner, v_requester, v_status, v_kind, v_start, v_end, v_st, v_et
    from public.staff_absences a
   where a.id = p_absence;

  if not found then
    raise exception 'Assenza non trovata';
  end if;

  if v_requester is distinct from v_me then
    raise exception 'Non è una tua richiesta';
  end if;

  if v_status not in ('pending', 'approved') then
    raise exception 'Questa richiesta è già chiusa';
  end if;

  if v_status = 'approved' and v_start <= public.local_now()::date then
    raise exception 'L''assenza è già cominciata: parlane con il titolare';
  end if;

  update public.staff_absences
     set status = 'withdrawn',
         resolved_by = v_me,
         resolved_at = now()
   where id = p_absence;

  v_range := public.absence_range_label(v_start, v_end, v_st, v_et);
  v_label := case v_kind
               when 'ferie'    then 'Ferie'
               when 'permesso' then 'Permesso'
               else 'Malattia'
             end;

  v_conv := public.conversation_for_pair(v_me, v_owner, null);

  insert into public.messages (conversation_id, sender_id, content, kind, absence_id)
  values (
    v_conv, v_me,
    case when v_status = 'pending'
         then 'Richiesta ritirata: ' || lower(v_label) || ' ' || v_range || '.'
         else v_label || ' ' || v_range || ': annullat'
              || case v_kind when 'ferie' then 'e' when 'permesso' then 'o' else 'a' end
              || '.'
    end,
    'absence_response', p_absence
  );

  if v_status = 'approved' then
    insert into public.notifications (user_id, type, title, body, related_id)
    values (
      v_owner,
      'absence_response',
      'Assenza annullata',
      coalesce((select full_name from public.profiles where id = v_me), 'Un professionista')
        || ' ha annullato: ' || lower(v_label) || ' ' || v_range,
      v_conv
    );
  end if;
end;
$$;

revoke execute on function public.withdraw_absence(uuid) from anon, public;
grant execute on function public.withdraw_absence(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Registrare dal lato titolare
-- ---------------------------------------------------------------------------
-- La malattia comunicata al telefono, le ferie concordate a voce. Nasce già
-- approvata, senza card né notifica: il professionista la vede nelle sue assenze.
create or replace function public.record_absence(
  p_person uuid,
  p_kind public.absence_kind,
  p_start date,
  p_end date,
  p_start_time time default null,
  p_end_time time default null,
  p_note text default null,
  p_inps_protocol text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := (select auth.uid());
  v_owner    uuid;
  v_sick     boolean := p_kind = 'malattia';
  v_protocol text := nullif(btrim(coalesce(p_inps_protocol, '')), '');
  v_id       uuid;
begin
  perform public.absence_validate(p_kind, p_start, p_end, p_start_time, p_end_time, v_protocol);

  select p.owner_id into v_owner
    from public.staff_people p
   where p.id = p_person;

  if not found or not public.can_manage_person(p_person, 'staff') then
    raise exception 'Persona non trovata';
  end if;

  perform public.absence_assert_no_overlap(p_person, p_start, p_end, p_start_time, p_end_time);

  insert into public.staff_absences
    (person_id, owner_id, kind, start_date, end_date, start_time, end_time,
     note, inps_protocol, status, requested_by, resolved_by, resolved_at)
  values
    (p_person, v_owner, p_kind, p_start, p_end, p_start_time, p_end_time,
     case when v_sick then null else nullif(btrim(coalesce(p_note, '')), '') end,
     case when v_sick then v_protocol end,
     'approved', null, v_me, now())
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function
  public.record_absence(uuid, public.absence_kind, date, date, time, time, text, text)
  from anon, public;
grant execute on function
  public.record_absence(uuid, public.absence_kind, date, date, time, time, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Il protocollo INPS, dopo
-- ---------------------------------------------------------------------------
create or replace function public.set_absence_inps_protocol(
  p_absence uuid,
  p_protocol text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := (select auth.uid());
  v_person uuid;
  v_kind   public.absence_kind;
  v_status public.absence_status;
begin
  select a.person_id, a.kind, a.status
    into v_person, v_kind, v_status
    from public.staff_absences a
   where a.id = p_absence;

  if not found then
    raise exception 'Assenza non trovata';
  end if;

  if not (
    exists (
      select 1 from public.staff_people p
       where p.id = v_person and p.waiter_id = v_me
    )
    or public.can_manage_person(v_person, 'staff')
  ) then
    raise exception 'Assenza non trovata';
  end if;

  if v_kind <> 'malattia' then
    raise exception 'Il protocollo INPS vale solo per la malattia';
  end if;

  if v_status <> 'approved' then
    raise exception 'Questa malattia è stata annullata';
  end if;

  update public.staff_absences
     set inps_protocol = nullif(btrim(coalesce(p_protocol, '')), '')
   where id = p_absence;
end;
$$;

revoke execute on function public.set_absence_inps_protocol(uuid, text) from anon, public;
grant execute on function public.set_absence_inps_protocol(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Categoria delle notifiche
-- ---------------------------------------------------------------------------
-- 'staff' e non 'shifts': riguardano la persona, non un turno. Riscrive la
-- versione di 20260916120200.
create or replace function public.notification_category(t public.notification_type)
returns text
language sql
immutable
set search_path = ''
as $$
  select case t
    when 'new_message'      then 'messages'
    when 'staff_invite'     then 'staff'
    when 'staff_response'   then 'staff'
    when 'staff_removed'    then 'staff'
    when 'staff_linked'     then 'staff'
    when 'team_linked'      then 'staff'
    when 'team_joined'      then 'staff'
    when 'team_removed'     then 'staff'
    when 'absence_request'  then 'staff'
    when 'absence_response' then 'staff'
    when 'absence_sick'     then 'staff'
    else 'shifts'  -- application_* + shift_* (candidature e turni)
  end;
$$;
