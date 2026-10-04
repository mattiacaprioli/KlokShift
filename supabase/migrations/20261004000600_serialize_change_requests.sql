-- B12: una richiesta di cambio turno riceve una sola decisione.
--
-- `withdraw_shift_change_request` e `resolve_shift_change_request` leggevano la
-- richiesta «pending» senza lock e la aggiornavano solo per id: due decisioni
-- contemporanee (approva/rifiuta, oppure ritiro e decisione) passavano entrambe
-- il controllo e producevano ciascuna la propria card in chat, la propria
-- notifica e — per una sostituzione — il proprio passaggio di mano.
--
-- Ora la riga della richiesta si legge `for update`: il secondo chiamante aspetta
-- il primo e, rilette le condizioni, non la trova più pending e riceve
-- «Richiesta non trovata o già chiusa», senza effetti. I permessi si
-- controllano dopo il lock. Il resto delle due funzioni è invariato
-- (20260920001100), compresa la semantica dell'orario concordato.

create or replace function public.withdraw_shift_change_request(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := (select auth.uid());
  r       record;
  v_owner uuid;
  v_conv  uuid;
begin
  select q.requested_by, q.shift_id, ve.workspace_id into r
    from public.shift_change_requests q
    join public.shifts s on s.id = q.shift_id
    join public.venues ve on ve.id = s.venue_id
   where q.id = p_request and q.status = 'pending'
   for update of q;
  if r.shift_id is null then
    raise exception 'Richiesta non trovata o già chiusa';
  end if;
  if r.requested_by is distinct from v_me then
    raise exception 'Non è una tua richiesta';
  end if;

  update public.shift_change_requests set status = 'withdrawn', resolved_by = v_me, resolved_at = now()
   where id = p_request;

  v_owner := private.workspace_primary_owner(r.workspace_id);
  if v_owner is not null and v_owner <> v_me then
    v_conv := private.conversation_for_pair(r.workspace_id, v_me, v_owner, r.shift_id);
    insert into public.messages (conversation_id, sender_id, content, kind, request_id)
    values (v_conv, v_me, 'Richiesta di cambio ritirata.', 'shift_change_response', p_request);
  end if;
end;
$$;

create or replace function public.resolve_shift_change_request(
  p_request uuid, p_approve boolean, p_replacement uuid default null, p_note text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := (select auth.uid());
  r        record;
  v_owner  uuid;
  v_conv   uuid;
  v_repl   text;
  v_body   text;
  v_content text;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_pre    record;
begin
  -- Ordine dei lock (come move_assignment/reassign, 20261004000500): turno,
  -- assegnazione, richiesta. Cancellare l'assegnazione aggiorna la richiesta
  -- (`on delete set null`), quindi chi sposta la persona blocca già in
  -- quest'ordine; prenderlo al contrario rischierebbe lo stallo.
  select q.shift_id, q.assignment_id into v_pre
    from public.shift_change_requests q where q.id = p_request;
  if v_pre.shift_id is null then
    raise exception 'Richiesta non trovata o già chiusa';
  end if;
  perform 1 from public.shifts s where s.id = v_pre.shift_id for update;
  perform 1 from public.shift_assignments x where x.id = v_pre.assignment_id for update;

  select q.assignment_id, q.shift_id, q.shift_date, q.requested_by, q.kind,
         q.proposed_start_time as t_start, q.proposed_end_time as t_end,
         ve.id as venue_id, ve.name as venue_name, ve.workspace_id,
         (select vm.member_id from public.shift_assignments x
            join public.venue_members vm on vm.id = x.venue_member_id
           where x.id = q.assignment_id) as member_id
    into r
    from public.shift_change_requests q
    join public.shifts s on s.id = q.shift_id
    join public.venues ve on ve.id = s.venue_id
   where q.id = p_request and q.status = 'pending'
   for update of q;
  if r.shift_id is null then
    raise exception 'Richiesta non trovata o già chiusa';
  end if;
  if not private.can(r.venue_id, 'shifts') or private.is_restricted_self(r.member_id) then
    raise exception 'Non sei tu a decidere su questo turno';
  end if;

  if p_approve and r.kind = 'substitution' and p_replacement is not null then
    select m.display_name into v_repl
      from public.venue_members vm join public.workspace_members m on m.id = vm.member_id
     where vm.id = p_replacement;
  end if;

  update public.shift_change_requests
     set status = (case when p_approve then 'approved' else 'rejected' end)::public.change_request_status,
         resolved_by = v_me, resolved_at = now(), resolution_note = v_note
   where id = p_request;

  if p_approve and r.kind = 'substitution' then
    if r.assignment_id is null then
      null;  -- l'assegnazione è già sparita per altra via: la richiesta si chiude lo stesso
    elsif p_replacement is not null then
      perform public.reassign(r.assignment_id, p_replacement);
    else
      delete from public.shift_assignments where id = r.assignment_id;
    end if;
  end if;

  if not p_approve then
    v_content := case when r.kind = 'hours' then 'Richiesta rifiutata: resta l''orario del turno.'
                      else 'Richiesta rifiutata: il turno resta tuo.' end;
    v_body := coalesce(r.venue_name, 'La sede') || ' ha rifiutato la richiesta del ' || to_char(r.shift_date, 'DD/MM');
  elsif r.kind = 'hours' then
    v_content := 'Orario concordato: ' || to_char(r.t_start, 'HH24:MI') || '–' || to_char(r.t_end, 'HH24:MI') || '.';
    v_body := coalesce(r.venue_name, 'La sede') || ' ha accettato il nuovo orario del ' || to_char(r.shift_date, 'DD/MM');
  else
    v_content := 'Richiesta approvata'
      || case when v_repl is not null then ': al tuo posto ' || v_repl else ': il turno resta scoperto' end || '.';
    v_body := coalesce(r.venue_name, 'La sede') || ' ha approvato il cambio del ' || to_char(r.shift_date, 'DD/MM');
  end if;
  if v_note is not null then
    v_content := v_content || ' ' || v_note;
  end if;

  v_owner := private.workspace_primary_owner(r.workspace_id);
  if v_owner is not null and v_owner <> r.requested_by then
    v_conv := private.conversation_for_pair(r.workspace_id, r.requested_by, v_owner, r.shift_id);
    insert into public.messages (conversation_id, sender_id, content, kind, request_id)
    values (v_conv, v_me, v_content, 'shift_change_response', p_request);
  end if;

  perform private.notify(
    r.requested_by, 'shift_change_response',
    case when p_approve then 'Richiesta accettata' else 'Richiesta rifiutata' end, v_body, v_conv
  );
end;
$$;
