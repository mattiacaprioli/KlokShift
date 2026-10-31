-- Ferie, permessi e malattia escono dalla chat (2026-10-31).
--
-- In chat le richieste restano solo per il cambio turno. Chi gestisce trova le
-- assenze nella Home («Richieste»), nella pagina Assenze e nelle notifiche; il
-- dipendente l'esito nelle notifiche e fra le proprie assenze. Le notifiche
-- non cambiano, salvo il `related_id`: non c'è più una conversazione a cui
-- rimandare, e l'app le apre sulla pagina Assenze.
--
-- Corpi da 20261005000300_commercial_rpc_guards (le ultime versioni), senza la
-- card. La nota della risposta, che prima stava solo nella card, passa nel
-- testo della notifica.
--
-- Le card già inviate si cancellano (decisione del 31/10): le assenze restano
-- intatte in `staff_absences`, sparisce solo il messaggio che le richiamava.
-- I valori `absence_request`/`absence_response` di `message_kind` e la colonna
-- `messages.absence_id` restano: toglierli costerebbe una riscrittura del tipo
-- per nessun vantaggio, e nessuna RPC li scrive più.

CREATE OR REPLACE FUNCTION public.request_absence(p_workspace uuid, p_kind absence_kind, p_start date, p_end date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_note text DEFAULT NULL::text, p_inps_protocol text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me       uuid := (select auth.uid());
  v_member   uuid;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_protocol text := nullif(btrim(coalesce(p_inps_protocol, '')), '');
  v_sick     boolean := p_kind = 'malattia';
  v_id       uuid;
  v_range    text;
  v_type     public.notification_type;
  v_title    text;
  v_body     text;
  v_user     uuid;
begin
  perform private.absence_validate(p_kind, p_start, p_end, p_start_time, p_end_time, v_protocol);

  select m.id into v_member from public.workspace_members m
   where m.workspace_id = p_workspace and m.user_id = v_me and m.status = 'active';
  if v_member is null then
    raise exception 'Non fai parte dell''organico di questa azienda';
  end if;
  if not v_sick and p_start < public.local_now()::date then
    raise exception 'Non puoi chiedere un''assenza per giorni già passati';
  end if;
  perform private.assert_workspace_operational(p_workspace);
  perform private.absence_assert_no_overlap(v_member, p_start, p_end, p_start_time, p_end_time);

  insert into public.staff_absences (
    member_id, kind, start_date, end_date, start_time, end_time, note, inps_protocol,
    status, requested_by, resolved_at
  ) values (
    v_member, p_kind, p_start, p_end, p_start_time, p_end_time,
    case when v_sick then null else v_note end, case when v_sick then v_protocol end,
    (case when v_sick then 'approved' else 'pending' end)::public.absence_status, v_me,
    case when v_sick then now() end
  ) returning id into v_id;

  v_range := private.absence_range_label(p_start, p_end, p_start_time, p_end_time);

  v_type := (case when v_sick then 'absence_sick' else 'absence_request' end)::public.notification_type;
  v_title := case p_kind when 'ferie' then 'Richiesta di ferie' when 'permesso' then 'Richiesta di permesso'
                         else 'Malattia comunicata' end;
  v_body := coalesce(private.member_name(p_workspace, v_me), 'Un professionista')
    || case p_kind when 'ferie' then ' chiede le ferie ' when 'permesso' then ' chiede un permesso '
                   else ' è in malattia ' end || v_range;

  -- A chi decide le assenze, tutti allo stesso modo: la richiesta si apre dalla
  -- pagina Assenze, non dalla chat.
  for v_user in select distinct private.member_managers(v_member, 'staff') loop
    perform private.notify(v_user, v_type, v_title, v_body);
  end loop;
  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_absence(p_absence uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me    uuid := (select auth.uid());
  a       record;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_label text;
begin
  perform private.assert_workspace_operational((select commercial_member.workspace_id from public.staff_absences commercial_absence join public.workspace_members commercial_member on commercial_member.id=commercial_absence.member_id where commercial_absence.id=p_absence));
  select x.member_id, x.requested_by, x.kind, x.start_date, x.end_date, x.start_time, x.end_time into a
    from public.staff_absences x
   where x.id = p_absence and x.status = 'pending'
   for update;
  if a.member_id is null then
    raise exception 'Richiesta non trovata o già chiusa';
  end if;
  if not private.can_person(a.member_id, 'staff') or private.is_restricted_self(a.member_id) then
    raise exception 'Non sei tu a decidere su questa richiesta';
  end if;

  update public.staff_absences
     set status = (case when p_approve then 'approved' else 'rejected' end)::public.absence_status,
         resolved_by = v_me, resolved_at = now(), resolution_note = v_note
   where id = p_absence;

  if a.requested_by is null then
    return;
  end if;

  v_label := case a.kind when 'ferie' then 'Ferie' else 'Permesso' end;

  -- L'esito arriva come notifica e si legge fra le proprie assenze.
  perform private.notify(
    a.requested_by, 'absence_response',
    case
      when a.kind = 'ferie' and p_approve then 'Ferie approvate'
      when a.kind = 'ferie' then 'Ferie rifiutate'
      when p_approve then 'Permesso approvato'
      else 'Permesso rifiutato'
    end,
    v_label || ' ' || private.absence_range_label(a.start_date, a.end_date, a.start_time, a.end_time)
      || case when v_note is not null then '. ' || v_note else '' end
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.withdraw_absence(p_absence uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me    uuid := (select auth.uid());
  a       record;
  v_ws    uuid;
  v_range text;
  v_label text;
  v_body  text;
  v_user  uuid;
begin
  perform private.assert_workspace_operational((select commercial_member.workspace_id from public.staff_absences commercial_absence join public.workspace_members commercial_member on commercial_member.id=commercial_absence.member_id where commercial_absence.id=p_absence));
  select x.member_id, x.requested_by, x.status, x.kind, x.start_date, x.end_date, x.start_time, x.end_time into a
    from public.staff_absences x
   where x.id = p_absence
   for update;
  if a.member_id is null then
    raise exception 'Assenza non trovata';
  end if;
  if a.requested_by is distinct from v_me then
    raise exception 'Non è una tua richiesta';
  end if;
  if a.status not in ('pending', 'approved') then
    raise exception 'Questa richiesta è già chiusa';
  end if;
  if a.status = 'approved' and a.start_date <= public.local_now()::date then
    raise exception 'L''assenza è già cominciata: parlane con il titolare';
  end if;

  update public.staff_absences set status = 'withdrawn', resolved_by = v_me, resolved_at = now()
   where id = p_absence;

  select m.workspace_id into v_ws from public.workspace_members m where m.id = a.member_id;
  v_range := private.absence_range_label(a.start_date, a.end_date, a.start_time, a.end_time);
  v_label := case a.kind when 'ferie' then 'Ferie' when 'permesso' then 'Permesso' else 'Malattia' end;

  if a.status = 'approved' then
    v_body := coalesce(private.member_name(v_ws, v_me), 'Un professionista')
      || ' ha annullato: ' || lower(v_label) || ' ' || v_range;
    for v_user in select distinct private.member_managers(a.member_id, 'staff') loop
      perform private.notify(v_user, 'absence_response', 'Assenza annullata', v_body);
    end loop;
  end if;
end;
$function$
;

delete from public.messages where kind in ('absence_request', 'absence_response');

-- L'elenco delle chat ordina per `last_message_at` (mantenuto da un trigger
-- sull'insert): dopo la cancellazione va ricalcolato. Una conversazione nata
-- solo per una card resta senza messaggi e sparisce dall'elenco (`!inner`).
update public.conversations c
   set last_message_at = (select max(m.created_at) from public.messages m where m.conversation_id = c.id)
 where c.last_message_at is distinct from
       (select max(m.created_at) from public.messages m where m.conversation_id = c.id);
