-- Una richiesta non è solo «sostituiscimi».
--
-- Il bisogno vero è più largo: «quel giorno posso fare fino alle 22 invece che
-- fino alle 23», «entro due ore dopo». Finora l'unica forma prevista era la
-- sostituzione, e chi voleva solo accorciare il turno doveva chiedere di essere
-- tolto del tutto — cioè dire una cosa più grossa di quella che intendeva.
--
-- ── Due tipi, e uno spazio per il terzo ──────────────────────────────────────
--
--   substitution  non posso venire, serve qualcun altro
--   hours         ci sono, ma su un orario diverso
--
-- Ferie e malattia ('time_off') arriveranno con la loro logica: qui si lascia
-- solo la forma pronta ad accoglierle (un `alter type ... add value`, in un file
-- a sé come sempre).
--
-- ── Cosa cambia all'approvazione ─────────────────────────────────────────────
--
-- **Niente, per 'hours'.** L'approvazione è un accordo messo per iscritto, non
-- una scrittura sui dati: il titolare poi aggiorna l'orario del turno o le ore
-- dal pannello. Scelta voluta — l'alternativa (scrivere `worked_hours` o un
-- orario personale sull'assegnazione) tocca la pipeline delle ore, che alimenta
-- il cedolino, e non è una cosa da far succedere come effetto collaterale di un
-- tap in chat. Resta il rischio del secondo passaggio dimenticato: per questo la
-- card resta nel thread con l'orario concordato scritto sopra.
--
-- Per 'substitution' non cambia niente rispetto a 20260915120000: con sostituto
-- passa da `reassign_shift_assignment`, senza sostituto il posto resta scoperto.

create type public.change_request_kind as enum ('substitution', 'hours');

alter table public.shift_change_requests
  add column kind public.change_request_kind not null default 'substitution',
  add column proposed_start_time time,
  add column proposed_end_time time;

-- Una fascia oraria, non un numero di ore: «4 ore» non dice se entra dopo o
-- esce prima, e il titolare deve poter coprire il buco. La fascia contiene già
-- la durata, il contrario no.
alter table public.shift_change_requests
  add constraint shift_change_requests_hours_ck check (
    (kind = 'hours')
    = (proposed_start_time is not null and proposed_end_time is not null)
  );

comment on column public.shift_change_requests.kind is
  'substitution = non posso venire; hours = ci sono ma su un altro orario. Approvare una richiesta hours non scrive niente: è un accordo, lo applica il titolare dal pannello del turno.';

-- ---------------------------------------------------------------------------
-- Aprire la richiesta: stessa funzione, tre parametri in più
-- ---------------------------------------------------------------------------
-- La versione a due argomenti va **eliminata**, non lasciata accanto: con i
-- default, una chiamata a due argomenti risulterebbe ambigua fra le due
-- funzioni e PostgREST fallirebbe con «could not choose the best candidate».
drop function if exists public.request_shift_change(uuid, text);

create or replace function public.request_shift_change(
  p_assignment uuid,
  p_reason text,
  p_kind public.change_request_kind default 'substitution',
  p_start time default null,
  p_end time default null
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
  v_label    text;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Scrivi il motivo della richiesta';
  end if;

  if p_kind = 'hours' and (p_start is null or p_end is null) then
    raise exception 'Indica il nuovo orario';
  end if;

  if p_kind = 'hours' and p_start = p_end then
    raise exception 'L''orario di fine non può essere uguale a quello di inizio';
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

  -- Una aperta per volta, di qualunque tipo: due card pendenti sullo stesso
  -- turno sono solo un modo per rispondere a una e dimenticare l'altra.
  if exists (
    select 1 from public.shift_change_requests r
     where r.assignment_id = p_assignment and r.status = 'pending'
  ) then
    raise exception 'Hai già una richiesta aperta su questo turno';
  end if;

  insert into public.shift_change_requests
    (assignment_id, shift_id, shift_date, requested_by, reason,
     kind, proposed_start_time, proposed_end_time)
  values
    (p_assignment, v_shift, v_date, v_me, btrim(p_reason),
     p_kind,
     case when p_kind = 'hours' then p_start end,
     case when p_kind = 'hours' then p_end end)
  returning id into v_request;

  v_conv := public.conversation_for_pair(v_me, v_owner, v_shift);

  -- `content` porta il motivo (e l'orario proposto, se c'è): chi non sa rendere
  -- la card — una versione vecchia dell'app, una notifica push — legge comunque
  -- la cosa giusta.
  if p_kind = 'hours' then
    v_label := 'Orario diverso ('
      || to_char(p_start, 'HH24:MI') || '–' || to_char(p_end, 'HH24:MI')
      || '): ';
  else
    v_label := '';
  end if;

  insert into public.messages (conversation_id, sender_id, content, kind, request_id)
  values (v_conv, v_me, v_label || btrim(p_reason), 'shift_change_request', v_request);

  insert into public.notifications (user_id, type, title, body, related_id)
  values (
    v_owner,
    'shift_change_request',
    case when p_kind = 'hours'
         then 'Richiesta di cambio orario'
         else 'Richiesta di cambio turno' end,
    coalesce(
      (select full_name from public.profiles where id = v_me),
      'Un professionista'
    )
    || case when p_kind = 'hours'
            then ' chiede un altro orario il '
            else ' chiede di essere sostituito il ' end
    || to_char(v_date, 'DD/MM'),
    v_conv
  );

  return v_request;
end;
$$;

revoke execute on function
  public.request_shift_change(uuid, text, public.change_request_kind, time, time)
  from anon, public;
grant execute on function
  public.request_shift_change(uuid, text, public.change_request_kind, time, time)
  to authenticated;

comment on function
  public.request_shift_change(uuid, text, public.change_request_kind, time, time) is
  'Il professionista chiede una sostituzione o un orario diverso su un proprio turno non concluso: crea la richiesta, la card nel thread di chat col titolare e la notifica.';

-- ---------------------------------------------------------------------------
-- Chiuderla: il tipo decide se si tocca l'assegnazione
-- ---------------------------------------------------------------------------
-- Rispetto a 20260915130000 cambia solo questo: su 'hours' l'approvazione non
-- cancella e non riassegna niente. Un sostituto passato su una richiesta di
-- orario viene ignorato di proposito — la card non lo offre nemmeno.
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
  v_kind       public.change_request_kind;
  v_start      time;
  v_end        time;
  v_conv       uuid;
  v_replacement_name text;
  v_body       text;
  v_content    text;
begin
  select r.assignment_id, r.shift_id, r.shift_date, r.requested_by, v.owner_id, v.name,
         r.kind, r.proposed_start_time, r.proposed_end_time
    into v_assignment, v_shift, v_date, v_requester, v_owner, v_venue,
         v_kind, v_start, v_end
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
    v_body := coalesce(v_venue, 'Il locale') || ' ha rifiutato la richiesta del '
      || to_char(v_date, 'DD/MM');
  elsif v_kind = 'hours' then
    v_content := 'Orario concordato: '
      || to_char(v_start, 'HH24:MI') || '–' || to_char(v_end, 'HH24:MI') || '.';
    v_body := coalesce(v_venue, 'Il locale') || ' ha accettato il nuovo orario del '
      || to_char(v_date, 'DD/MM');
  else
    v_content := 'Richiesta approvata'
      || case when v_replacement_name is not null
              then ': al tuo posto ' || v_replacement_name
              else ': il turno resta scoperto' end
      || '.';
    v_body := coalesce(v_venue, 'Il locale') || ' ha approvato il cambio del '
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
