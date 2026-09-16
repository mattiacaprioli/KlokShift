-- Ferie, permessi e malattia: avvisare anche i collaboratori con «Organico».
--
-- Fino a qui (20260918100200) la richiesta avvisava **solo** il titolare, con la
-- motivazione che la card vive in chat e la chat è la coppia (professionista,
-- titolare). Ma decidere su quelle richieste non è del titolare soltanto:
-- `resolve_absence` accetta chiunque passi `can_manage_person(person,'staff')`,
-- e il blocco «Richieste» in home mostra le pendenti a chi ha quel permesso.
-- Il collaboratore poteva decidere e non lo sapeva: doveva passare dalla home e
-- guardare.
--
-- Chi riceve l'avviso è quindi **chi può agire**, non chi il professionista
-- sceglie: la RLS non guarda chi è stato avvisato, quindi far scegliere il
-- destinatario sarebbe una promessa di riservatezza che il database non
-- mantiene — e costringerebbe il dipendente a conoscere l'organigramma
-- dell'azienda. Il titolare che ha delegato del tutto silenzia la categoria
-- 'staff' dalle sue preferenze (`notification_category`, 20260716120000): non
-- serve un'impostazione nuova.
--
-- ⚠️ Due insert e non uno, perché il `related_id` è diverso: al titolare la
-- conversazione (la card sta nel thread), ai delegati **niente** — quel thread
-- la RLS non glielo apre, e la notifica li porterebbe su una schermata vuota.
-- Senza `related_id` l'instradamento client li manda in home, dove il blocco
-- «Richieste» è il posto in cui quelle assenze si decidono
-- (`src/features/notifications/routing.ts`, `web/src/lib/notificationRoute.ts`).

-- ---------------------------------------------------------------------------
-- 1. Chi deve saperlo
-- ---------------------------------------------------------------------------
-- Il gemello *lista* di `can_manage_person` (20260918100200): stesso insieme,
-- ma parametrizzato sulla persona invece che su `auth.uid()`. Deve restare
-- identico — chi riceve l'avviso deve poter agire, e chi può agire deve essere
-- avvisato.
--
-- Non si riusa `notify_venue_managers` (20260916130100): quella è **per sede**,
-- e un'assenza è della persona × azienda. Chiamandola a ciclo sulle sedi, un
-- collaboratore con accesso a due sedi della stessa persona riceverebbe due
-- notifiche; qui il `union` deduplica una volta sola.
create or replace function public.absence_managers(
  p_person uuid,
  p_perm   text default 'staff'
)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.owner_id
    from public.staff_people p
   where p.id = p_person
  union
  select a.user_id
    from public.venue_access a
    join public.staff_members sm
      on sm.venue_id    = a.venue_id
     and sm.person_id   = p_person
     and sm.link_status <> 'left'
   where a.status = 'active'
     and a.user_id is not null
     and case p_perm
           when 'shifts' then a.can_manage_shifts
           when 'staff'  then a.can_manage_staff
           when 'hours'  then a.can_view_hours
           else false
         end;
$$;

-- Come `notify_venue_managers`: si chiama solo da dentro altre funzioni
-- DEFINER, mai dal client.
revoke execute on function public.absence_managers(uuid, text)
  from anon, authenticated, public;

comment on function public.absence_managers(uuid, text) is
  'Chi può decidere sulle assenze di una persona: il titolare più i collaboratori attivi con quel permesso su una sede in cui la persona è in organico.';

-- ---------------------------------------------------------------------------
-- 2. Chiedere (o comunicare la malattia)
-- ---------------------------------------------------------------------------
-- Riscrive 20260918100200. Unica differenza: il secondo insert su
-- `notifications`. Titolo e testo sono gli stessi per tutti — passano da
-- variabili invece che da due `case` gemelli.
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
  v_type     public.notification_type;
  v_title    text;
  v_body     text;
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

  v_type := (case when v_sick then 'absence_sick' else 'absence_request' end)
            ::public.notification_type;
  v_title := case p_kind
               when 'ferie'    then 'Richiesta di ferie'
               when 'permesso' then 'Richiesta di permesso'
               else 'Malattia comunicata'
             end;
  v_body := v_name || case p_kind
                        when 'ferie'    then ' chiede le ferie '
                        when 'permesso' then ' chiede un permesso '
                        else ' è in malattia '
                      end || v_range;

  insert into public.notifications (user_id, type, title, body, related_id)
  values (p_owner, v_type, v_title, v_body, v_conv);

  -- I collaboratori con «Organico». Niente `related_id`: vedi la testa del file.
  --
  -- ⚠️ `<> v_me` non è teorico: un membro dell'organico promosso a gestire la
  -- sede (F3, 20260916140000) resta `waiter`, chiede le proprie ferie da qui, e
  -- senza quella riga si manderebbe la notifica da solo.
  insert into public.notifications (user_id, type, title, body, related_id)
  select t.uid, v_type, v_title, v_body, null
    from public.absence_managers(v_person, 'staff') as t(uid)
   where t.uid <> p_owner
     and t.uid <> v_me;

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
  'Il professionista chiede ferie o un permesso (pending) o comunica una malattia (approved) a un titolare di cui è in organico: crea l''assenza, la card nel thread di chat e le notifiche a chi può deciderla.';

-- ---------------------------------------------------------------------------
-- 3. Decidere
-- ---------------------------------------------------------------------------
-- Riscrive 20260918100200. Unica differenza: il **mittente** del messaggio nel
-- thread.
--
-- ⚠️ La conversazione è la coppia (professionista, titolare) e la chat decide il
-- lato della bolla con `sender_id === userId`. Scrivendo la risposta a nome di
-- chi ha deciso, una risposta data da un collaboratore entrava nel thread con un
-- mittente che non ne fa parte: sul telefono del titolare compariva a sinistra,
-- come se «Ferie approvate» l'avesse scritto il professionista. A nome del
-- titolare la conversazione resta una conversazione fra due. Chi ha deciso resta
-- scritto in `staff_absences.resolved_by`.
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
  values (v_conv, v_owner, v_content, 'absence_response', p_absence);

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
-- 4. Ritirare
-- ---------------------------------------------------------------------------
-- Riscrive 20260918100200. Unica differenza: l'avviso ai collaboratori sul ramo
-- 'approved' — un'assenza già approvata e poi annullata rimette la persona in
-- circolazione, e chi fa i turni deve saperlo quanto il titolare. Il ramo
-- 'pending' resta senza notifiche: lì la card nel thread basta.
create or replace function public.withdraw_absence(p_absence uuid)
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
  v_status    public.absence_status;
  v_kind      public.absence_kind;
  v_start     date;
  v_end       date;
  v_st        time;
  v_et        time;
  v_range     text;
  v_label     text;
  v_conv      uuid;
  v_body      text;
begin
  select a.person_id, a.owner_id, a.requested_by, a.status, a.kind,
         a.start_date, a.end_date, a.start_time, a.end_time
    into v_person, v_owner, v_requester, v_status, v_kind, v_start, v_end, v_st, v_et
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
    v_body := coalesce((select full_name from public.profiles where id = v_me), 'Un professionista')
      || ' ha annullato: ' || lower(v_label) || ' ' || v_range;

    insert into public.notifications (user_id, type, title, body, related_id)
    values (v_owner, 'absence_response', 'Assenza annullata', v_body, v_conv);

    insert into public.notifications (user_id, type, title, body, related_id)
    select t.uid, 'absence_response', 'Assenza annullata', v_body, null
      from public.absence_managers(v_person, 'staff') as t(uid)
     where t.uid <> v_owner
       and t.uid <> v_me;
  end if;
end;
$$;

revoke execute on function public.withdraw_absence(uuid) from anon, public;
grant execute on function public.withdraw_absence(uuid) to authenticated;
