-- F2 — le funzioni `security definer` e la persona vista da una sede.
--
-- La F0 ha riscritto venti policy, ma le policy non sono tutto il perimetro: una
-- funzione DEFINER **scavalca la RLS** e ricava da sé chi sia il titolare, con un
-- `= auth.uid()` scritto a mano. Finché restano così, i permessi Organico, Ore e
-- Documenti sono interruttori che non accendono niente — e due funzioni
-- INVOKER (`get_person_performance`, `get_person_worked_shifts`) fanno il
-- contrario: si fidano della RLS di `shift_assignments`, che è scopata sui
-- *turni*, e servirebbero le ore a chi ha solo il permesso turni.
--
-- Qui il perimetro diventa uno solo: `my_venue_ids(perm)`.
--
-- ⚠️ Prerequisiti: 20260916110000, 20260916120000, 20260916120200, 20260916120300.

-- ---------------------------------------------------------------------------
-- 1. Un permesso in più: 'roster'
-- ---------------------------------------------------------------------------
-- Chi organizza i turni **deve** poter leggere `staff_members`: senza l'organico
-- della sede non c'è nessuno da mettere sul turno, e il permesso «Turni» da solo
-- sarebbe una schermata con un bottone che non apre niente.
--
-- Ma leggere non è gestire: 'roster' apre la sola SELECT. Aggiungere una persona,
-- cambiarle le mansioni o toglierla dall'organico restano su 'staff', dove erano.
--
-- ⚠️ La riga di `staff_members` porta anche `phone` e `note`, che sono un mirror
-- di `staff_people` (20260913100000): una policy di SELECT non sa restringere le
-- colonne, quindi chi ha i turni vede anche il numero di telefono di chi mette in
-- turno. È accettato, non sfuggito — chi fa i turni telefona a chi deve coprirli.
-- Le note del titolare invece no: vanno spostate su `staff_people` e basta. F4.
create or replace function public.my_venue_ids(p_perm text default 'shifts')
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.id from public.venues v
   where v.owner_id = (select auth.uid())
  union
  select a.venue_id from public.venue_access a
   where a.user_id = (select auth.uid())
     and a.status  = 'active'
     and case p_perm
           when 'any'       then true
           when 'shifts'    then a.can_manage_shifts
           when 'staff'     then a.can_manage_staff
           when 'hours'     then a.can_view_hours
           when 'documents' then a.can_manage_documents
           when 'venue'     then a.can_manage_venue
           -- Sola lettura dell'organico: la serve sia chi fa i turni sia chi
           -- gestisce le persone.
           when 'roster'    then a.can_manage_shifts or a.can_manage_staff
           -- ⚠️ Un permesso sconosciuto nega, non concede: un refuso in una
           -- policy futura deve costare una schermata vuota, mai un accesso.
           else false
         end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Leggere l'organico della sede
-- ---------------------------------------------------------------------------
-- Unica policy della F0 che cambia: la SELECT scende da 'staff' a 'roster'. Le
-- altre tre (insert/update/delete) restano su 'staff'.
drop policy if exists "staff_members: owner read" on public.staff_members;
create policy "staff_members: owner read"
  on public.staff_members for select
  to authenticated
  using (staff_members.venue_id in (select public.my_venue_ids('roster')));

-- ---------------------------------------------------------------------------
-- 3. Nome e foto di chi è in organico
-- ---------------------------------------------------------------------------
-- Le due policy di 20260913100000:386,400 passano da `staff_people.owner_id`, che
-- per un delegato non è mai `auth.uid()`: senza questo ramo l'organico gli
-- mostrerebbe «Scheda senza account» per tutti e nessuna foto — lo stesso guasto
-- silenzioso che 20260912130000 era andato a riparare.
--
-- Il ramo del titolare resta per primo e **identico**: parte da
-- `staff_people_waiter_idx` in un salto solo, ed è il caso che gira sempre.
drop policy if exists "profiles: manager reads own staff" on public.profiles;
create policy "profiles: manager reads own staff"
  on public.profiles for select
  to authenticated
  using (
    -- Il guard sul ruolo resta: da qui si leggono i profili dei professionisti
    -- in organico, non quelli di altri gestori.
    role = 'waiter'::public.user_role
    and (
      exists (
        select 1 from public.staff_people p
         where p.waiter_id = profiles.id and p.owner_id = (select auth.uid())
      )
      or exists (
        select 1 from public.staff_members sm
         where sm.waiter_id = profiles.id
           and sm.venue_id in (select public.my_venue_ids('roster'))
      )
    )
  );

drop policy if exists "waiter_profiles: manager reads own staff" on public.waiter_profiles;
create policy "waiter_profiles: manager reads own staff"
  on public.waiter_profiles for select
  to authenticated
  using (
    exists (
      select 1 from public.staff_people p
       where p.waiter_id = waiter_profiles.id and p.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.staff_members sm
       where sm.waiter_id = waiter_profiles.id
         and sm.venue_id in (select public.my_venue_ids('roster'))
    )
  );

-- ---------------------------------------------------------------------------
-- 4. La persona, limitata alle sedi che il delegato gestisce
-- ---------------------------------------------------------------------------
-- `staff_people` è l'anagrafica **dell'azienda**: una riga per dipendente, con le
-- ore, i documenti e il contratto. Il titolare la vede tutta (`staff_people: owner
-- all`). Il delegato ne vede solo le persone che lavorano in una sua sede, e solo
-- con il permesso Organico.
--
-- ⚠️ Limite noto e accettato: la RLS filtra righe, non colonne. Un delegato con
-- 'staff' che interroga l'API direttamente legge anche `contract_hours`,
-- `contract_period`, `note` ed `email` delle persone delle sue sedi. L'app quei
-- campi non glieli mostra (la card Contratto è dietro `isOwner`), ma è
-- l'interfaccia a nasconderli, non il database a negarli.
-- Renderlo vero vuol dire togliere quelle colonne da `authenticated` e servirle
-- da una RPC DEFINER anche al titolare: è un refactor della scheda persona, non
-- una riga di policy. F4. Fino ad allora il confine vero è **chi** si invita.
drop policy if exists "staff_people: delegate reads venue people" on public.staff_people;
create policy "staff_people: delegate reads venue people"
  on public.staff_people for select
  to authenticated
  using (
    exists (
      select 1 from public.staff_members sm
       where sm.person_id = staff_people.id
         and sm.venue_id in (select public.my_venue_ids('staff'))
    )
  );

-- Aggiungere una persona: l'anagrafica nasce prima dell'appartenenza, quindi qui
-- non c'è ancora una sede da cui dedurre il permesso. Si guarda dall'altro verso:
-- `owner_id` dev'essere il titolare di una sede su cui il delegato ha 'staff'.
drop policy if exists "staff_people: delegate creates" on public.staff_people;
create policy "staff_people: delegate creates"
  on public.staff_people for insert
  to authenticated
  with check (
    exists (
      select 1 from public.venues v
       where v.owner_id = staff_people.owner_id
         and v.id in (select public.my_venue_ids('staff'))
    )
  );

-- Correggere nome, telefono, email. Nessun DELETE: cancellare un'anagrafica
-- porta via ore e documenti di un'azienda che non è la sua.
drop policy if exists "staff_people: delegate updates" on public.staff_people;
create policy "staff_people: delegate updates"
  on public.staff_people for update
  to authenticated
  using (
    exists (
      select 1 from public.staff_members sm
       where sm.person_id = staff_people.id
         and sm.venue_id in (select public.my_venue_ids('staff'))
    )
  )
  with check (
    exists (
      select 1 from public.staff_members sm
       where sm.person_id = staff_people.id
         and sm.venue_id in (select public.my_venue_ids('staff'))
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Documenti
-- ---------------------------------------------------------------------------
-- ⚠️ Questa funzione la usano **sia** la policy di `staff_documents` **sia** quelle
-- di `storage.objects` (20260913100100): restano la stessa frase, altrimenti una
-- riga leggibile punterebbe a un file che non si apre.
--
-- Il ramo nuovo è il terzo: una sede in comune **e** il permesso Documenti. Non
-- basta gestire la sede — HACCP, contratti e certificati medici sono l'unica
-- cosa in questa app che un collaboratore può vedere e che non riguarda il
-- lavoro da organizzare.
create or replace function public.can_access_staff_person_documents(p_person uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
      from public.staff_people p
     where p.id = p_person
       and (p.owner_id = (select auth.uid()) or p.waiter_id = (select auth.uid()))
  )
  or exists (
    select 1
      from public.staff_members sm
     where sm.person_id = p_person
       and sm.venue_id in (select public.my_venue_ids('documents'))
  );
$$;

-- ---------------------------------------------------------------------------
-- 6. Chi può scrivere il consuntivo di un'assegnazione
-- ---------------------------------------------------------------------------
-- `freeze_assignment_payroll` (20260913110000) decide, a ogni update, quali campi
-- di `shift_assignments` sopravvivono. Finora la domanda era una sola — «sei il
-- titolare?» — e per un delegato la risposta è no: `worked_hours`, `role_id` e
-- `status` gli tornerebbero indietro **in silenzio**. Con il permesso Turni
-- attivo, trascinare una persona su un turno sembrerebbe funzionare e non
-- salverebbe la mansione.
--
-- Ora le domande sono due, perché i campi non sono la stessa cosa:
--   · `role_id` e `status` sono gestione del turno  → 'shifts';
--   · `worked_hours` è la cifra che va in busta paga → 'hours'.
-- Per il titolare entrambe rispondono sì, come prima.
create or replace function public.freeze_assignment_payroll()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue     uuid;
  v_can_shift boolean;
  v_can_hours boolean;
  v_is_over   boolean;
begin
  -- Uscita a costo zero: gli update più frequenti non toccano nessuno di questi
  -- campi e non devono pagare un join per scoprirlo.
  if new.worked_hours is not distinct from old.worked_hours
     and new.role_id is not distinct from old.role_id
     and new.status  is not distinct from old.status
     and new.confirmed_at is not distinct from old.confirmed_at then
    return new;
  end if;

  select s.venue_id,
         public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
    into v_venue, v_is_over
    from public.shifts s
   where s.id = new.shift_id;

  v_can_shift := coalesce(public.can_manage_venue(v_venue, 'shifts'), false);
  v_can_hours := coalesce(public.can_manage_venue(v_venue, 'hours'),  false);

  if not v_can_hours then
    -- Le ore consuntivate non le scrive chi non ha quel permesso, in silenzio
    -- (non è un errore dell'utente: è una scrittura che dall'interfaccia non
    -- esiste nemmeno).
    new.worked_hours := old.worked_hours;
  end if;

  if not v_can_shift then
    new.role_id := old.role_id;

    -- `coalesce(v_is_over, true)`: se il turno non si trova, si congela.
    if coalesce(v_is_over, true)
       or new.status not in ('confirmed', 'declined') then
      new.status := old.status;
    end if;
  end if;

  -- `confirmed_at` è derivato, per entrambi i lati: è il timestamp del gesto di
  -- conferma del professionista. Chi gestisce il turno e segna una presenza a
  -- fine serata ('confirmed' = «c'era») non deve poterlo far comparire: quella è
  -- una presenza constatata, non una conferma data in anticipo.
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    new.confirmed_at := case
      when v_can_shift then old.confirmed_at
      else now()
    end;
  elsif new.status in ('assigned', 'declined') then
    -- L'impegno è stato ritirato (rifiuto) o riaperto (turno modificato): la
    -- vecchia conferma non vale più.
    new.confirmed_at := null;
  else
    -- 'no_show' **non** azzera niente: «aveva confermato e non si è presentato»
    -- è esattamente il fatto che il titolare vuole poter rileggere.
    new.confirmed_at := old.confirmed_at;
  end if;

  return new;
end;
$$;

revoke execute on function public.freeze_assignment_payroll()
  from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 7. Le ore
-- ---------------------------------------------------------------------------
-- Le tre funzioni di 20260913110100, con il solo perimetro cambiato. Per il
-- titolare `my_venue_ids('hours')` è l'elenco delle sue sedi: stesse righe,
-- stesso piano di esecuzione, stesso ordine.
--
-- ⚠️ In `get_person_performance` e `get_person_worked_shifts` il filtro è
-- **nuovo**, non sostituito: prima non c'era, e quelle due si affidavano alla sola
-- RLS di `shift_assignments`, che passa da 'shifts'. Senza questa riga un
-- delegato con i soli turni leggerebbe ore, assenze e affidabilità.
create or replace function public.get_owner_hours_summary(
  p_from date,
  p_to   date
)
returns table (
  person_id    uuid,
  person_name  text,
  venue_id     uuid,
  venue_name   text,
  venue_closed boolean,
  roles        text,
  shifts_count integer,
  hours        numeric
)
language sql
stable
set search_path = ''
as $$
  with per_venue as (
    select
      p.id        as person_id,
      p.full_name as person_name,
      v.id        as venue_id,
      v.name      as venue_name,
      v.closed_at as venue_closed_at,
      sm.id         as member_id,
      count(*)::int as shifts_count,
      sum(coalesce(
        a.worked_hours,
        public.shift_duration_hours(s.start_time, s.end_time)
      )) as hours
    from public.shift_assignments a
    join public.shifts s         on s.id  = a.shift_id
    join public.venues v         on v.id  = s.venue_id
    join public.staff_members sm on sm.id = a.staff_member_id
    join public.staff_people p   on p.id  = sm.person_id
    -- Il filtro resta esplicito e non lasciato alla sola RLS: è QUESTO predicato
    -- che guida l'indice. `in (select …)` su una funzione `stable` senza
    -- correlazione con la riga viene valutato una volta per statement (InitPlan),
    -- non una volta per riga.
    where v.id in (select public.my_venue_ids('hours'))
      and s.kind = 'internal'
      and s.date >= p_from
      and s.date <  p_to
      and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
      and a.status not in ('declined', 'no_show')
    group by p.id, p.full_name, v.id, v.name, v.closed_at, sm.id
  )
  select
    r.person_id,
    r.person_name,
    r.venue_id,
    r.venue_name,
    r.venue_closed_at is not null,
    (
      select string_agg(vr.name, ', ' order by vr.sort_order, vr.name)
        from public.staff_member_roles smr
        join public.venue_roles vr on vr.id = smr.role_id
       where smr.staff_member_id = r.member_id
         and vr.archived_at is null
    ),
    r.shifts_count,
    r.hours
  from per_venue r
  order by sum(r.hours) over (partition by r.person_id) desc,
           r.person_name,
           r.venue_name;
$$;

create or replace function public.get_person_performance(p_person uuid)
returns table (
  past_total     integer,
  worked_count   integer,
  no_show_count  integer,
  declined_count integer,
  total_hours    numeric,
  month_shifts   integer,
  month_hours    numeric
)
language sql
stable
set search_path = ''
as $$
  with past as (
    select
      a.status,
      coalesce(
        a.worked_hours,
        public.shift_duration_hours(s.start_time, s.end_time)
      ) as hours,
      s.date
    from public.shift_assignments a
    join public.staff_members sm on sm.id = a.staff_member_id
    join public.shifts s         on s.id  = a.shift_id
    where sm.person_id = p_person
      and s.venue_id in (select public.my_venue_ids('hours'))
      and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
  )
  select
    count(*)::int,
    count(*) filter (where status not in ('declined', 'no_show'))::int,
    count(*) filter (where status = 'no_show')::int,
    count(*) filter (where status = 'declined')::int,
    coalesce(sum(hours) filter (where status not in ('declined', 'no_show')), 0),
    count(*) filter (
      where status not in ('declined', 'no_show')
        and date >= date_trunc('month', public.local_now())::date
    )::int,
    coalesce(sum(hours) filter (
      where status not in ('declined', 'no_show')
        and date >= date_trunc('month', public.local_now())::date
    ), 0)
  from past;
$$;

create or replace function public.get_person_worked_shifts(
  p_person uuid,
  p_limit  integer default 6
)
returns table (
  id           uuid,
  status       public.assignment_status,
  worked_hours numeric,
  shift_id     uuid,
  title        text,
  date         date,
  start_time   time,
  end_time     time,
  hours        numeric,
  venue_id     uuid,
  venue_name   text
)
language sql
stable
set search_path = ''
as $$
  select
    a.id, a.status, a.worked_hours,
    s.id, s.title, s.date, s.start_time, s.end_time,
    coalesce(
      a.worked_hours,
      public.shift_duration_hours(s.start_time, s.end_time)
    ),
    v.id, v.name
  from public.shift_assignments a
  join public.staff_members sm on sm.id = a.staff_member_id
  join public.shifts s         on s.id  = a.shift_id
  join public.venues v         on v.id  = s.venue_id
  where sm.person_id = p_person
    and v.id in (select public.my_venue_ids('hours'))
    and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
    and a.status not in ('declined', 'no_show')
  -- `order by s.date desc, s.start_time desc` com'era (20260912090000:196): è già
  -- cronologico all'indietro anche coi turni notturni, perché un turno appartiene
  -- al giorno in cui INIZIA. Non "correggerlo".
  order by s.date desc, s.start_time desc
  limit greatest(p_limit, 0);
$$;

-- ---------------------------------------------------------------------------
-- 8. Le tre deprecate se ne vanno
-- ---------------------------------------------------------------------------
-- 20260913110100 le aveva lasciate in piedi «finché la build N-1 è in
-- circolazione». Nessuna build è pubblicata (M8 non è fatta) e il client non le
-- chiama più da nessuna parte. Restare vorrebbe dire tre funzioni con il vecchio
-- perimetro `owner_id = auth.uid()` da ricordarsi di aggiornare a ogni fase: si
-- droppano, che è anche l'unico modo di essere sicuri che nessuno le chiami.
drop function if exists public.get_venue_hours_summary(uuid, date, date);
drop function if exists public.get_staff_performance(uuid);
drop function if exists public.get_staff_worked_shifts(uuid, integer);

-- ---------------------------------------------------------------------------
-- 9. Togliere qualcuno dall'organico
-- ---------------------------------------------------------------------------
-- Identica a 20260914103531 salvo il controllo di accesso: da «sei il titolare
-- della sede» a «gestisci l'organico di questa sede». `v_owner` resta, ma ora
-- serve solo a sapere a chi non mandare la notifica.
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
  v_name     text;
  v_future   int;
begin
  select sm.waiter_id, sm.venue_id, v.owner_id, v.name, sm.display_name
    into v_waiter, v_venue_id, v_owner, v_venue, v_name
    from public.staff_members sm
    join public.venues v on v.id = sm.venue_id
   where sm.id = p_staff_id and sm.link_status <> 'left';

  if v_venue_id is null
     or not public.can_manage_venue(v_venue_id, 'staff') then
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

  -- Il titolare lo viene a sapere quando non è stato lui a farlo.
  if v_owner is not null and v_owner <> (select auth.uid()) then
    insert into public.notifications (user_id, type, title, body, related_id)
    values (
      v_owner,
      'staff_response',
      'Un membro è uscito dall''organico',
      coalesce(v_name, 'Un professionista') || ' non fa più parte dello staff di '
        || coalesce(v_venue, 'un locale'),
      v_venue_id
    );
  end if;
end;
$$;

revoke execute on function public.remove_staff_member(uuid) from anon, public;
grant execute on function public.remove_staff_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Chiudere una richiesta di cambio turno
-- ---------------------------------------------------------------------------
-- Identica a 20260915140000 salvo il controllo di accesso. `v_owner` resta e
-- **non** diventa `v_me`: la conversazione è la coppia (professionista, titolare)
-- e non è scopata per sede (20260913100200). Un delegato che risponde scrive
-- dentro quel thread, firmato da `v_me` come mittente del messaggio.
create or replace function public.resolve_shift_change_request(
  p_request uuid,
  p_approve boolean,
  p_replacement uuid default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me         uuid := (select auth.uid());
  v_assignment uuid;
  v_shift      uuid;
  v_venue      uuid;
  v_date       date;
  v_requester  uuid;
  v_owner      uuid;
  v_venue_name text;
  v_kind       public.change_request_kind;
  v_start      time;
  v_end        time;
  v_conv       uuid;
  v_replacement_name text;
  v_body       text;
  v_content    text;
begin
  select r.assignment_id, r.shift_id, r.shift_date, r.requested_by,
         v.id, v.owner_id, v.name,
         r.kind, r.proposed_start_time, r.proposed_end_time
    into v_assignment, v_shift, v_date, v_requester,
         v_venue, v_owner, v_venue_name,
         v_kind, v_start, v_end
    from public.shift_change_requests r
    join public.shifts s on s.id = r.shift_id
    join public.venues v on v.id = s.venue_id
   where r.id = p_request
     and r.status = 'pending';

  if not found then
    raise exception 'Richiesta non trovata o già chiusa';
  end if;

  if not public.can_manage_venue(v_venue, 'shifts') then
    raise exception 'Non sei tu a decidere su questo turno';
  end if;

  if p_approve and v_kind = 'substitution' and p_replacement is not null then
    select sm.display_name into v_replacement_name
      from public.staff_members sm where sm.id = p_replacement;
  end if;

  update public.shift_change_requests
     set status = (case when p_approve then 'approved' else 'rejected' end)
                  ::public.change_request_status,
         resolved_by = v_me,
         resolved_at = now(),
         resolution_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_request;

  if p_approve and v_kind = 'substitution' then
    if v_assignment is null then
      -- L'assegnazione è già sparita per altra via (turno riassegnato a mano,
      -- persona tolta dal turno): la richiesta si chiude lo stesso.
      null;
    elsif p_replacement is not null then
      perform public.reassign_shift_assignment(v_assignment, p_replacement);
    else
      delete from public.shift_assignments where id = v_assignment;
    end if;
  end if;

  if not p_approve then
    v_content := case when v_kind = 'hours'
                      then 'Richiesta rifiutata: resta l''orario del turno.'
                      else 'Richiesta rifiutata: il turno resta tuo.' end;
    v_body := coalesce(v_venue_name, 'Il locale') || ' ha rifiutato la richiesta del '
      || to_char(v_date, 'DD/MM');
  elsif v_kind = 'hours' then
    v_content := 'Orario concordato: '
      || to_char(v_start, 'HH24:MI') || '–' || to_char(v_end, 'HH24:MI') || '.';
    v_body := coalesce(v_venue_name, 'Il locale') || ' ha accettato il nuovo orario del '
      || to_char(v_date, 'DD/MM');
  else
    v_content := 'Richiesta approvata'
      || case when v_replacement_name is not null
              then ': al tuo posto ' || v_replacement_name
              else ': il turno resta scoperto' end
      || '.';
    v_body := coalesce(v_venue_name, 'Il locale') || ' ha approvato il cambio del '
      || to_char(v_date, 'DD/MM');
  end if;

  if nullif(btrim(coalesce(p_note, '')), '') is not null then
    v_content := v_content || ' ' || btrim(p_note);
  end if;

  v_conv := public.conversation_for_pair(v_requester, v_owner, v_shift);

  insert into public.messages (conversation_id, sender_id, content, kind, request_id)
  values (v_conv, v_me, v_content, 'shift_change_response', p_request);

  insert into public.notifications (user_id, type, title, body, related_id)
  values (
    v_requester,
    'shift_change_response',
    case when p_approve then 'Richiesta accettata' else 'Richiesta rifiutata' end,
    v_body,
    v_conv
  );
end;
$$;

revoke execute on function public.resolve_shift_change_request(uuid, boolean, uuid, text)
  from anon, public;
grant execute on function public.resolve_shift_change_request(uuid, boolean, uuid, text)
  to authenticated;
