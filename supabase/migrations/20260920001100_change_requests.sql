-- Baseline — 12/N: richieste di cambio turno (sostituzione / altro orario).
--
-- Il professionista chiede dal proprio turno; la richiesta è una card nella chat
-- col titolare; chi gestisce i turni approva o rifiuta. Una sola richiesta
-- aperta per turno. I messaggi di errore sono per l'utente: restano in italiano.

create function public.request_shift_change(
  p_assignment uuid, p_reason text,
  p_kind public.change_request_kind default 'substitution',
  p_start time default null, p_end time default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me      uuid := (select auth.uid());
  a         record;
  v_owner   uuid;
  v_conv    uuid;
  v_request uuid;
  v_label   text;
  v_user    uuid;
  v_body    text;
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

  select m.user_id as who, s.id as shift_id, s.date, s.venue_id, ve.workspace_id, x.status,
         public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now() as over
    into a
    from public.shift_assignments x
    join public.venue_members vm on vm.id = x.venue_member_id
    join public.workspace_members m on m.id = vm.member_id
    join public.shifts s on s.id = x.shift_id
    join public.venues ve on ve.id = s.venue_id
   where x.id = p_assignment;
  if a.shift_id is null then
    raise exception 'Assegnazione non trovata';
  end if;
  if a.who is distinct from v_me then
    raise exception 'Non è il tuo turno';
  end if;
  if a.over then
    raise exception 'Il turno è già concluso';
  end if;
  if a.status not in ('assigned', 'confirmed') then
    raise exception 'Questo turno non è più tuo';
  end if;
  -- Una aperta per volta, di qualunque tipo: due card pendenti sullo stesso turno
  -- sono solo un modo per rispondere a una e dimenticare l'altra.
  if exists (
    select 1 from public.shift_change_requests r where r.assignment_id = p_assignment and r.status = 'pending'
  ) then
    raise exception 'Hai già una richiesta aperta su questo turno';
  end if;

  insert into public.shift_change_requests (
    assignment_id, shift_id, shift_date, requested_by, reason, kind, proposed_start_time, proposed_end_time
  ) values (
    p_assignment, a.shift_id, a.date, v_me, btrim(p_reason), p_kind,
    case when p_kind = 'hours' then p_start end, case when p_kind = 'hours' then p_end end
  ) returning id into v_request;

  v_owner := private.workspace_primary_owner(a.workspace_id);
  if v_owner is not null and v_owner <> v_me then
    v_conv := private.conversation_for_pair(a.workspace_id, v_me, v_owner, a.shift_id);
    v_label := case when p_kind = 'hours'
                    then 'Orario diverso (' || to_char(p_start, 'HH24:MI') || '–' || to_char(p_end, 'HH24:MI') || '): '
                    else '' end;
    insert into public.messages (conversation_id, sender_id, content, kind, request_id)
    values (v_conv, v_me, v_label || btrim(p_reason), 'shift_change_request', v_request);
  end if;

  v_body := coalesce((select p.full_name from public.profiles p where p.id = v_me), 'Un professionista')
    || case when p_kind = 'hours' then ' chiede un altro orario il ' else ' chiede di essere sostituito il ' end
    || to_char(a.date, 'DD/MM');
  for v_user in select distinct private.managers_of(a.venue_id, 'shifts') loop
    perform private.notify(
      v_user, 'shift_change_request',
      case when p_kind = 'hours' then 'Richiesta di cambio orario' else 'Richiesta di cambio turno' end,
      v_body, case when v_user = v_owner then v_conv end
    );
  end loop;
  return v_request;
end;
$$;

-- Niente notifica: chi ritira toglie un impegno, non ne aggiunge uno. La riga nel
-- thread basta perché il titolare capisca cos'è successo.
create function public.withdraw_shift_change_request(p_request uuid)
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
   where q.id = p_request and q.status = 'pending';
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

-- Approva o rifiuta. Sostituzione approvata: il turno passa a p_replacement (una
-- riga di organico della stessa sede) oppure resta scoperto. Chi ha «Turni» decide,
-- ma non sulla propria richiesta.
create function public.resolve_shift_change_request(
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
begin
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
   where q.id = p_request and q.status = 'pending';
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

grant execute on function
  public.request_shift_change(uuid, text, public.change_request_kind, time, time),
  public.withdraw_shift_change_request(uuid),
  public.resolve_shift_change_request(uuid, boolean, uuid, text)
to authenticated;
