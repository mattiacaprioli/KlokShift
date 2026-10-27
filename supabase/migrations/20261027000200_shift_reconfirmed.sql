-- Il ripensamento dopo un rifiuto si dice a chi gestisce (revisione E05).
--
-- Il dipendente che tocca «Non posso» per sbaglio ora ritrova il turno in
-- agenda e può tornare con «Ci sono, conferma». Chi gestisce però ha già letto
-- «Turno rifiutato» e magari ha messo qualcun altro: senza un avviso, il posto
-- si raddoppierebbe in silenzio. Avvisa gli stessi destinatari del rifiuto, e
-- solo quando a riconfermare è la persona stessa: chi gestisce che segna
-- «c'era» su una riga rifiutata sa già cosa sta facendo.

create function public.notify_on_assignment_reconfirmed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_date date;
  v_name text;
  v_user uuid;
begin
  if old.status <> 'declined' or new.status <> 'confirmed' then
    return new;
  end if;
  select m.display_name, m.user_id into v_name, v_user
    from public.venue_members vm join public.workspace_members m on m.id = vm.member_id
   where vm.id = new.venue_member_id;
  if v_user is distinct from (select auth.uid()) then
    return new;
  end if;
  select s.date into v_date from public.shifts s where s.id = new.shift_id;

  perform private.notify_managers(
    new.venue_id, 'shifts', 'shift_reconfirmed', 'Turno confermato di nuovo',
    coalesce(v_name, 'Un professionista') || ' aveva rifiutato il turno del '
      || to_char(v_date, 'DD/MM') || ' e ora lo conferma: controlla di non averlo già sostituito',
    new.shift_id
  );
  return new;
end;
$$;
create trigger shift_assignments_notify_reconfirmed after update of status on public.shift_assignments
  for each row execute function public.notify_on_assignment_reconfirmed();

-- La persona della notifica: come per il rifiuto, solo chi ha risposto.
CREATE OR REPLACE FUNCTION private.notification_person(
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
  elsif p_type in ('shift_declined', 'shift_reconfirmed') then
    -- Solo la persona che ha risposto: un gestore che modifica una risposta
    -- non deve apparire come il professionista nominato dalla notifica.
    select m.id into v_person
      from public.shift_assignments a
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.workspace_members m on m.id = vm.member_id
     where a.shift_id = p_related
       and a.status = case when p_type = 'shift_declined'
                           then 'declined'::public.assignment_status
                           else 'confirmed'::public.assignment_status end
       and m.user_id = p_actor
     limit 1;
    return v_person;
  end if;
  return null;
end;
$$;
