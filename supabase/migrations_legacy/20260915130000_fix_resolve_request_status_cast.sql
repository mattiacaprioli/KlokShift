-- Fix: «column "status" is of type public.change_request_status but expression
-- is of type text».
--
-- In 20260915120000 lo stato si scriveva così:
--
--     set status = case when p_approve then 'approved' else 'rejected' end
--
-- Dentro un `case` i due letterali non restano `unknown` — Postgres risolve il
-- tipo del `case` **prima** di guardare la colonna di destinazione, e due
-- stringhe senza contesto diventano `text`. Fuori da un `case` (come in
-- `withdraw_shift_change_request`, che scrive `status = 'withdrawn'`) il
-- letterale resta `unknown` e viene risolto sulla colonna: per questo quello
-- funzionava e questo no.
--
-- Unica riga cambiata rispetto a 20260915120000: il cast esplicito.
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
     set status = (case when p_approve then 'approved' else 'rejected' end)
                  ::public.change_request_status,
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
