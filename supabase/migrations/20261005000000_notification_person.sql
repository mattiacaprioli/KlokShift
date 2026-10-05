-- La persona raffigurata dalla notifica è un membro dell'azienda, mai un nome
-- estratto dal testo. Gli avvisi generali restano senza persona.
alter table public.notifications add column person_id uuid
  references public.workspace_members(id) on delete set null;

create function private.notification_person(
  p_recipient uuid, p_type public.notification_type, p_related uuid, p_actor uuid
) returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_person uuid;
  v_candidates uuid[];
begin
  if p_type in ('staff_linked', 'staff_response') then
    select m.id into v_person from public.workspace_members m where m.id = p_related;
    return v_person;
  end if;

  if p_type in ('new_message', 'absence_request', 'absence_sick', 'shift_change_request')
     and p_related is not null then
    -- Per queste categorie il riferimento è la conversazione: la stessa
    -- controparte che si vede aprendo il thread, anche nelle notifiche storiche.
    select m.id into v_person
      from public.conversations c
      join public.workspace_members m on m.workspace_id = c.workspace_id
       and m.user_id = case when c.user_a = p_recipient then c.user_b else c.user_a end
     where c.id = p_related and p_recipient in (c.user_a, c.user_b);
    return v_person;
  end if;

  if p_actor is null then return null; end if;

  if p_type in ('absence_request', 'absence_sick', 'shift_change_request') then
    -- I collaboratori non ricevono un riferimento al thread del titolare.
    -- L'attore è certo nella nuova notifica; se condivide più aziende gestite
    -- dal destinatario, non si indovina quale scheda raffigurare.
    select array_agg(m.id) into v_candidates
      from public.workspace_members m
     where m.user_id = p_actor
       and p_recipient in (select private.member_managers(
         m.id, case when p_type = 'shift_change_request' then 'shifts' else 'staff' end
       ));
    if cardinality(v_candidates) = 1 then return v_candidates[1]; end if;
  elsif p_type = 'shift_declined' then
    -- Solo la persona che ha rifiutato: un gestore che modifica una risposta
    -- non deve apparire come il professionista nominato dalla notifica.
    select m.id into v_person
      from public.shift_assignments a
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.workspace_members m on m.id = vm.member_id
     where a.shift_id = p_related and a.status = 'declined' and m.user_id = p_actor
     limit 1;
    return v_person;
  end if;
  return null;
end;
$$;
revoke all on function private.notification_person(uuid, public.notification_type, uuid, uuid)
  from public, anon, authenticated;

create function private.set_notification_person()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.person_id := private.notification_person(new.user_id, new.type, new.related_id, (select auth.uid()));
  return new;
end;
$$;
revoke all on function private.set_notification_person() from public, anon, authenticated;
create trigger notifications_person before insert on public.notifications
  for each row execute function private.set_notification_person();

-- Recupero storico soltanto dai riferimenti certi: scheda o conversazione.
-- Senza attore storico non si usa chi sta applicando la migrazione.
update public.notifications n
   set person_id = private.notification_person(n.user_id, n.type, n.related_id, null)
 where n.type in ('new_message', 'staff_linked', 'staff_response',
                  'absence_request', 'absence_sick', 'shift_change_request');
