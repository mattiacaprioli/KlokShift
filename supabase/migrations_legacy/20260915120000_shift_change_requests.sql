-- «Non posso più, trovatemi un cambio».
--
-- Dopo aver confermato un turno il professionista non ha nessun gesto
-- disponibile: `freeze_assignment_payroll` (20260913110000) gli lascia scrivere
-- 'confirmed' e 'declined', ma l'interfaccia non offre il rifiuto dopo la
-- conferma — ed è giusto così, perché a quel punto il locale ci ha pianificato
-- sopra. Nella realtà quel bisogno esiste comunque, e finiva in chat come testo
-- libero che nessuno tracciava: il titolare se lo ricordava a memoria.
--
-- Da qui la regola, che vale per tutti:
--
--   assegnazione 'assigned'   →  «Conferma presenza» / «Non posso» (immediato)
--   assegnazione 'confirmed'  →  **solo** richiesta di sostituzione, decide il locale
--
-- Il dipendente fisso, che nasce già 'confirmed' (20260915100000), ha quindi
-- solo la seconda: non rifiuta un turno, chiede il cambio. È esattamente come
-- funziona con un dipendente.
--
-- ── Perché una tabella e non un messaggio ────────────────────────────────────
--
-- La richiesta **vive in chat** (è lì che la si scrive e la si legge), ma il suo
-- stato non può stare in un messaggio: riguarda un turno, la conversazione è
-- della coppia, e la si risolve anche da un'altra schermata. Il messaggio porta
-- solo il puntatore.

-- ---------------------------------------------------------------------------
-- 1) La richiesta
-- ---------------------------------------------------------------------------
create type public.change_request_status as enum (
  'pending', 'approved', 'rejected', 'withdrawn'
);

create table public.shift_change_requests (
  id uuid primary key default gen_random_uuid(),

  -- ⚠️ Nullable e `on delete set null`, non `cascade`: approvare una richiesta
  -- **cancella** l'assegnazione (`reassign_shift_assignment` fa delete+insert,
  -- e senza sostituto si elimina e basta). Con un cascade la richiesta appena
  -- approvata sparirebbe insieme alla riga, portandosi via la card dalla chat e
  -- ogni traccia di cosa è stato deciso.
  assignment_id uuid references public.shift_assignments(id) on delete set null,

  -- Il turno resta il riferimento stabile, e regge l'autorizzazione del titolare
  -- anche quando l'assegnazione non c'è più.
  shift_id uuid not null references public.shifts(id) on delete cascade,
  -- Copia della data al momento della richiesta: serve a scrivere «il turno del
  -- 20/09» nella card anche a chi, dopo l'approvazione, non ha più il permesso
  -- di leggere quel turno (la policy dei turni passa da is_my_assigned_shift).
  shift_date date not null,

  requested_by uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (btrim(reason) <> ''),

  status public.change_request_status not null default 'pending',
  resolved_by uuid references public.profiles(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- Una richiesta aperta per volta su uno stesso turno: due card pendenti nello
-- stesso thread sarebbero solo un modo per approvarne una e dimenticare l'altra.
create unique index shift_change_requests_one_pending
  on public.shift_change_requests (assignment_id)
  where status = 'pending' and assignment_id is not null;

create index shift_change_requests_shift_idx
  on public.shift_change_requests (shift_id);
create index shift_change_requests_requester_idx
  on public.shift_change_requests (requested_by, created_at desc);

alter table public.shift_change_requests enable row level security;

-- Sola lettura, per le due parti. Si scrive **solo** dalle RPC qui sotto: stessa
-- scelta dell'invito staff (20260712085513), per non aprire policy di UPDATE
-- larghe su una riga che decide chi lavora.
create policy "shift_change_requests: requester read"
  on public.shift_change_requests for select
  to authenticated
  using (requested_by = (select auth.uid()));

create policy "shift_change_requests: owner read"
  on public.shift_change_requests for select
  to authenticated
  using (
    exists (
      select 1
        from public.shifts s
        join public.venues v on v.id = s.venue_id
       where s.id = shift_change_requests.shift_id
         and v.owner_id = (select auth.uid())
    )
  );

comment on table public.shift_change_requests is
  'Richiesta di sostituzione su un turno: la apre il professionista, la chiude il titolare. Si scrive solo via request_shift_change / resolve_shift_change_request / withdraw_shift_change_request.';

-- ---------------------------------------------------------------------------
-- 2) La chat impara a portare qualcosa che non è testo
-- ---------------------------------------------------------------------------
-- `messages` aveva solo `content`. Un enum nuovo si può creare e usare nella
-- stessa transazione (il divieto vale per i valori aggiunti a un enum esistente).
create type public.message_kind as enum (
  'text', 'shift_change_request', 'shift_change_response'
);

alter table public.messages
  add column kind public.message_kind not null default 'text',
  add column request_id uuid references public.shift_change_requests(id) on delete set null;

comment on column public.messages.kind is
  'text = messaggio scritto da una persona. Gli altri valori sono righe di servizio scritte dalle RPC: il client le rende come card, e content resta il testo di ripiego.';

-- Le righe di servizio non passano dalla notifica generica «Nuovo messaggio»:
-- la notifica giusta (con il suo titolo e la sua destinazione) la manda la RPC
-- che ha inserito la riga. Senza questa guardia arrivavano due notifiche e due
-- push per lo stesso gesto.
create or replace function public.notify_on_new_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter    uuid;
  v_manager   uuid;
  v_recipient uuid;
  v_sender    text;
begin
  if new.kind <> 'text' then
    return new;
  end if;

  select c.waiter_id, c.manager_id
    into v_waiter, v_manager
    from public.conversations c
    where c.id = new.conversation_id;

  if v_waiter is null then
    return new;
  end if;

  v_recipient := case when new.sender_id = v_waiter then v_manager else v_waiter end;

  -- Dedupe: se c'è già una notifica non letta per questa conversazione non se
  -- ne crea un'altra; il badge del tab Messaggi conta comunque i messaggi.
  if exists (
    select 1 from public.notifications n
    where n.user_id = v_recipient
      and n.type = 'new_message'
      and n.related_id = new.conversation_id
      and n.read_at is null
  ) then
    return new;
  end if;

  -- Nome mittente dalla fonte unica: ristoratore → nome locale, cameriere →
  -- waiter_public_cards. (Stessa risoluzione del client via get_chat_counterparts.)
  select name into v_sender
    from public.chat_counterpart(new.sender_id, new.sender_id = v_manager);

  insert into public.notifications (user_id, type, title, body, related_id)
  values (
    v_recipient, 'new_message', 'Nuovo messaggio',
    coalesce(v_sender, 'Qualcuno') || ': ' || left(new.content, 80),
    new.conversation_id
  );
  return new;
end;
$$;

revoke execute on function public.notify_on_new_message() from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 3) Helper: la conversazione della coppia, trovata o creata
-- ---------------------------------------------------------------------------
-- Stessa semantica di `getOrCreateConversation` lato client (src/features/chat/
-- api.ts): find-then-insert, e `shift_id` **non** si tocca se la conversazione
-- esiste già — è il contesto del primo contatto, non dell'ultimo.
create or replace function public.conversation_for_pair(
  p_waiter uuid,
  p_manager uuid,
  p_shift uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id
    from public.conversations
   where waiter_id = p_waiter and manager_id = p_manager;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.conversations (waiter_id, manager_id, shift_id)
  values (p_waiter, p_manager, p_shift)
  on conflict (waiter_id, manager_id) do nothing
  returning id into v_id;

  if v_id is null then
    -- Corsa persa contro un'altra sessione: la riga c'è, è solo di qualcun altro.
    select id into v_id
      from public.conversations
     where waiter_id = p_waiter and manager_id = p_manager;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.conversation_for_pair(uuid, uuid, uuid)
  from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 4) Aprire la richiesta
-- ---------------------------------------------------------------------------
-- Tre cose in una transazione: la richiesta, la card nel thread, la notifica.
-- Se il titolare non ha ancora mai scritto a questa persona, la conversazione
-- nasce qui.
create or replace function public.request_shift_change(
  p_assignment uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := (select auth.uid());
  v_waiter   uuid;
  v_owner    uuid;
  v_shift    uuid;
  v_date     date;
  v_status   public.assignment_status;
  v_over     boolean;
  v_conv     uuid;
  v_request  uuid;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Scrivi il motivo della richiesta';
  end if;

  select sm.waiter_id, v.owner_id, s.id, s.date, a.status,
         public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
    into v_waiter, v_owner, v_shift, v_date, v_status, v_over
    from public.shift_assignments a
    join public.staff_members sm on sm.id = a.staff_member_id
    join public.shifts s on s.id = a.shift_id
    join public.venues v on v.id = s.venue_id
   where a.id = p_assignment;

  if not found then
    raise exception 'Assegnazione non trovata';
  end if;

  -- L'unico che può chiedere il cambio è chi quel turno ce l'ha.
  if v_waiter is distinct from v_me then
    raise exception 'Non è il tuo turno';
  end if;

  if v_over then
    raise exception 'Il turno è già concluso';
  end if;

  if v_status not in ('assigned', 'confirmed') then
    raise exception 'Questo turno non è più tuo';
  end if;

  if exists (
    select 1 from public.shift_change_requests r
     where r.assignment_id = p_assignment and r.status = 'pending'
  ) then
    raise exception 'Hai già una richiesta aperta su questo turno';
  end if;

  insert into public.shift_change_requests
    (assignment_id, shift_id, shift_date, requested_by, reason)
  values
    (p_assignment, v_shift, v_date, v_me, btrim(p_reason))
  returning id into v_request;

  v_conv := public.conversation_for_pair(v_me, v_owner, v_shift);

  -- `content` porta il motivo: chi non sa rendere la card (una versione vecchia
  -- dell'app, una notifica push) legge comunque la cosa giusta.
  insert into public.messages (conversation_id, sender_id, content, kind, request_id)
  values (v_conv, v_me, btrim(p_reason), 'shift_change_request', v_request);

  insert into public.notifications (user_id, type, title, body, related_id)
  values (
    v_owner,
    'shift_change_request',
    'Richiesta di cambio turno',
    coalesce(
      (select full_name from public.profiles where id = v_me),
      'Un professionista'
    ) || ' chiede di essere sostituito il ' || to_char(v_date, 'DD/MM'),
    v_conv
  );

  return v_request;
end;
$$;

revoke execute on function public.request_shift_change(uuid, text) from anon, public;
grant execute on function public.request_shift_change(uuid, text) to authenticated;

comment on function public.request_shift_change(uuid, text) is
  'Il professionista chiede di essere sostituito su un proprio turno non concluso: crea la richiesta, la card nel thread di chat col titolare e la notifica.';

-- ---------------------------------------------------------------------------
-- 5) Chiuderla
-- ---------------------------------------------------------------------------
-- Approvare con un sostituto passa da `reassign_shift_assignment` (20260911120000):
-- fa delete+insert, quindi partono da sole «Turno revocato» a chi esce e «Nuovo
-- turno assegnato» a chi entra, e chi entra non eredita né lo stato né le ore.
-- Approvare senza sostituto lascia il posto scoperto: è una risposta legittima
-- («va bene, non venire»), e `notify_on_assignment_removed` avvisa comunque.
--
-- ⚠️ L'ordine conta: lo stato della richiesta si scrive **prima** di toccare
-- l'assegnazione, perché la cancellazione porta `assignment_id` a null e
-- l'indice di unicità sulle pending ragiona su quella colonna.
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
  v_date       date;
  v_requester  uuid;
  v_owner      uuid;
  v_venue      text;
  v_conv       uuid;
  v_replacement_name text;
  v_body       text;
  v_content    text;
begin
  select r.assignment_id, r.shift_id, r.shift_date, r.requested_by, v.owner_id, v.name
    into v_assignment, v_shift, v_date, v_requester, v_owner, v_venue
    from public.shift_change_requests r
    join public.shifts s on s.id = r.shift_id
    join public.venues v on v.id = s.venue_id
   where r.id = p_request
     and r.status = 'pending';

  if not found then
    raise exception 'Richiesta non trovata o già chiusa';
  end if;

  if v_owner is distinct from v_me then
    raise exception 'Non sei tu a decidere su questo turno';
  end if;

  if p_approve and p_replacement is not null then
    select sm.display_name into v_replacement_name
      from public.staff_members sm where sm.id = p_replacement;
  end if;

  update public.shift_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         resolved_by = v_me,
         resolved_at = now(),
         resolution_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_request;

  if p_approve then
    if v_assignment is null then
      -- L'assegnazione è già sparita per altra via (turno riassegnato a mano,
      -- persona tolta dal turno): la richiesta si chiude lo stesso, non c'è più
      -- niente da spostare.
      null;
    elsif p_replacement is not null then
      perform public.reassign_shift_assignment(v_assignment, p_replacement);
    else
      delete from public.shift_assignments where id = v_assignment;
    end if;
  end if;

  if p_approve then
    v_content := 'Richiesta approvata'
      || case when v_replacement_name is not null
              then ': al tuo posto ' || v_replacement_name
              else ': il turno resta scoperto' end
      || '.';
    v_body := coalesce(v_venue, 'Il locale') || ' ha approvato il cambio del '
      || to_char(v_date, 'DD/MM');
  else
    v_content := 'Richiesta rifiutata: il turno resta tuo.';
    v_body := coalesce(v_venue, 'Il locale') || ' ha rifiutato il cambio del '
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
    case when p_approve then 'Cambio approvato' else 'Cambio rifiutato' end,
    v_body,
    v_conv
  );
end;
$$;

revoke execute on function public.resolve_shift_change_request(uuid, boolean, uuid, text)
  from anon, public;
grant execute on function public.resolve_shift_change_request(uuid, boolean, uuid, text)
  to authenticated;

comment on function public.resolve_shift_change_request(uuid, boolean, uuid, text) is
  'Il titolare approva (con o senza sostituto) o rifiuta una richiesta di cambio turno. Con sostituto passa da reassign_shift_assignment, così partono le notifiche a chi entra e a chi esce.';

-- ---------------------------------------------------------------------------
-- 6) Ritirarla
-- ---------------------------------------------------------------------------
-- Senza questa, una richiesta aperta e poi risolta a voce resterebbe pendente
-- per sempre e l'indice di unicità impedirebbe di aprirne un'altra.
create or replace function public.withdraw_shift_change_request(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me        uuid := (select auth.uid());
  v_requester uuid;
  v_shift     uuid;
  v_owner     uuid;
  v_conv      uuid;
begin
  select r.requested_by, r.shift_id, v.owner_id
    into v_requester, v_shift, v_owner
    from public.shift_change_requests r
    join public.shifts s on s.id = r.shift_id
    join public.venues v on v.id = s.venue_id
   where r.id = p_request
     and r.status = 'pending';

  if not found then
    raise exception 'Richiesta non trovata o già chiusa';
  end if;

  if v_requester is distinct from v_me then
    raise exception 'Non è una tua richiesta';
  end if;

  update public.shift_change_requests
     set status = 'withdrawn', resolved_by = v_me, resolved_at = now()
   where id = p_request;

  v_conv := public.conversation_for_pair(v_me, v_owner, v_shift);

  -- Niente notifica: chi ritira toglie un impegno, non ne aggiunge uno. La riga
  -- nel thread basta perché il titolare capisca cos'è successo.
  insert into public.messages (conversation_id, sender_id, content, kind, request_id)
  values (v_conv, v_me, 'Richiesta di cambio ritirata.', 'shift_change_response', p_request);
end;
$$;

revoke execute on function public.withdraw_shift_change_request(uuid) from anon, public;
grant execute on function public.withdraw_shift_change_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) Un rifiuto non deve più passare inosservato
-- ---------------------------------------------------------------------------
-- Prima di oggi nessun trigger girava sugli UPDATE di `shift_assignments`: se il
-- professionista rifiutava un turno, il titolare se ne accorgeva solo se in quel
-- momento era collegato al realtime. Un posto tornato scoperto è esattamente il
-- genere di cosa per cui esistono le notifiche.
create or replace function public.notify_on_assignment_declined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_date  date;
  v_name  text;
begin
  if new.status <> 'declined' or old.status = 'declined' then
    return new;
  end if;

  select v.owner_id, s.date
    into v_owner, v_date
    from public.shifts s
    join public.venues v on v.id = s.venue_id
   where s.id = new.shift_id;

  -- È il titolare stesso a segnare il rifiuto (correzione dal pannello del
  -- turno): non si manda una notifica a chi l'ha appena scritta.
  if v_owner is null or v_owner = (select auth.uid()) then
    return new;
  end if;

  select sm.display_name into v_name
    from public.staff_members sm where sm.id = new.staff_member_id;

  insert into public.notifications (user_id, type, title, body, related_id)
  values (
    v_owner,
    'shift_declined',
    'Turno rifiutato',
    coalesce(v_name, 'Un professionista') || ' ha rifiutato il turno del '
      || to_char(v_date, 'DD/MM'),
    new.shift_id
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
