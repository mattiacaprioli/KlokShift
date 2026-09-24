-- Serializza creazioni e transizioni delle assenze.
--
-- Ordine dei lock:
--   1. request_absence/record_absence bloccano la riga workspace_members;
--   2. ricontrollano gli overlap;
--   3. inseriscono l'assenza.
-- Tutti gli ingressi usano absence_assert_no_overlap, quindi per una persona
-- può esserci un solo check+insert alla volta; persone diverse non si bloccano.
--
-- resolve_absence/withdraw_absence bloccano invece la singola assenza prima di
-- validarne lo stato. Chi arriva secondo vede lo stato già committato e decide
-- su quello, senza produrre card o notifiche da una lettura obsoleta.

create or replace function private.absence_assert_no_overlap(
  p_member uuid, p_start date, p_end date, p_start_time time, p_end_time time
) returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  -- Lock comune a request_absence e record_absence. Deve precedere sempre la
  -- lettura di staff_absences per mantenere un solo ordine ed evitare deadlock.
  perform 1 from public.workspace_members m where m.id = p_member for update;
  if not found then
    raise exception 'Persona non trovata';
  end if;

  if exists (
    select 1 from public.staff_absences a
     where a.member_id = p_member and a.status in ('pending', 'approved')
       and a.start_date <= p_end and a.end_date >= p_start
       and (a.start_time is null or p_start_time is null
            or (a.start_time < p_end_time and p_start_time < a.end_time))
  ) then
    raise exception 'C''è già un''assenza in quelle date';
  end if;
end;
$$;

create or replace function public.resolve_absence(
  p_absence uuid, p_approve boolean, p_note text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := (select auth.uid());
  a       record;
  v_ws    uuid;
  v_owner uuid;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_label text;
  v_content text;
  v_conv  uuid;
begin
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

  select m.workspace_id into v_ws from public.workspace_members m where m.id = a.member_id;
  v_owner := private.workspace_primary_owner(v_ws);
  v_label := case a.kind when 'ferie' then 'Ferie' else 'Permesso' end;
  v_content := v_label || ' ' || private.absence_range_label(a.start_date, a.end_date, a.start_time, a.end_time)
    || case when p_approve then ': approvat' else ': rifiutat' end
    || case when a.kind = 'ferie' then 'e.' else 'o.' end;
  if v_note is not null then
    v_content := v_content || ' ' || v_note;
  end if;

  if v_owner is not null and v_owner <> a.requested_by then
    v_conv := private.conversation_for_pair(v_ws, a.requested_by, v_owner);
    insert into public.messages (conversation_id, sender_id, content, kind, absence_id)
    values (v_conv, v_owner, v_content, 'absence_response', p_absence);
  end if;

  perform private.notify(
    a.requested_by, 'absence_response',
    case
      when a.kind = 'ferie' and p_approve then 'Ferie approvate'
      when a.kind = 'ferie' then 'Ferie rifiutate'
      when p_approve then 'Permesso approvato'
      else 'Permesso rifiutato'
    end,
    v_label || ' ' || private.absence_range_label(a.start_date, a.end_date, a.start_time, a.end_time),
    v_conv
  );
end;
$$;

-- Parte dall'ultima definizione (20260921000200), che usa il nome della scheda
-- aziendale nelle notifiche invece del nome globale del profilo.
create or replace function public.withdraw_absence(p_absence uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := (select auth.uid());
  a       record;
  v_ws    uuid;
  v_owner uuid;
  v_range text;
  v_label text;
  v_conv  uuid;
  v_body  text;
  v_user  uuid;
begin
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
  v_owner := private.workspace_primary_owner(v_ws);
  v_range := private.absence_range_label(a.start_date, a.end_date, a.start_time, a.end_time);
  v_label := case a.kind when 'ferie' then 'Ferie' when 'permesso' then 'Permesso' else 'Malattia' end;

  if v_owner is not null and v_owner <> v_me then
    v_conv := private.conversation_for_pair(v_ws, v_me, v_owner);
    insert into public.messages (conversation_id, sender_id, content, kind, absence_id)
    values (v_conv, v_me,
      case when a.status = 'pending'
           then 'Richiesta ritirata: ' || lower(v_label) || ' ' || v_range || '.'
           else v_label || ' ' || v_range || ': annullat'
                || case a.kind when 'ferie' then 'e' when 'permesso' then 'o' else 'a' end || '.'
      end,
      'absence_response', p_absence);
  end if;

  if a.status = 'approved' then
    v_body := coalesce(private.member_name(v_ws, v_me), 'Un professionista')
      || ' ha annullato: ' || lower(v_label) || ' ' || v_range;
    for v_user in select distinct private.member_managers(a.member_id, 'staff') loop
      perform private.notify(v_user, 'absence_response', 'Assenza annullata', v_body,
        case when v_user = v_owner then v_conv end);
    end loop;
  end if;
end;
$$;
