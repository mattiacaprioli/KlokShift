-- «Non posso» con un motivo facoltativo (revisione dipendente E12).
--
-- Il rifiuto arrivava a chi gestisce senza un perché («Mario ha rifiutato il
-- turno del 20/09»), mentre nella richiesta di cambio il motivo è obbligatorio.
-- Qui resta facoltativo: rifiutare un turno non ancora confermato è una
-- risposta, non una richiesta da decidere. Se c'è, va in coda alla notifica e
-- chi gestisce lo legge accanto a «Rifiutato».
--
-- Vale solo finché la riga è rifiutata: qualunque cambio di stato lo cancella
-- (chi riconferma, chi gestisce che segna «c'era»), così un vecchio motivo non
-- resta attaccato a una persona che poi ha lavorato.

alter table public.shift_assignments
  add column decline_reason text
  check (decline_reason is null or (btrim(decline_reason) <> '' and char_length(decline_reason) <= 300));

create function public.clear_decline_reason()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status <> 'declined' then
    new.decline_reason := null;
  end if;
  return new;
end;
$$;
create trigger shift_assignments_clear_decline_reason
  before update of status, decline_reason on public.shift_assignments
  for each row execute function public.clear_decline_reason();

-- Stessa funzione (20261005000300), più `p_reason`: con il default le build che
-- mandano due argomenti continuano a funzionare.
drop function public.respond_assignment(uuid, public.assignment_status);

create function public.respond_assignment(
  p_assignment uuid, p_status public.assignment_status, p_reason text default null
)
returns public.shift_assignments
language plpgsql security definer set search_path = '' as $$
declare
  a     record;
  v_row public.shift_assignments;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shift_assignments x join public.venues v on v.id=x.venue_id where x.id=p_assignment));
  if p_status not in ('confirmed', 'declined') then
    raise exception 'invalid_status' using errcode = '23514';
  end if;
  select x.id, x.shift_id, m.user_id, s.status as shift_status into a
    from public.shift_assignments x
    join public.venue_members vm on vm.id = x.venue_member_id
    join public.workspace_members m on m.id = vm.member_id
    join public.shifts s on s.id = x.shift_id
   where x.id = p_assignment;
  if a.id is null or a.user_id is distinct from (select auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if a.shift_status = 'cancelled' then
    raise exception 'shift_cancelled' using errcode = '23514';
  end if;
  if private.shift_is_over(a.shift_id) then
    raise exception 'shift_finished' using errcode = '23514';
  end if;

  update public.shift_assignments
     set status = p_status,
         confirmed_at = case when p_status = 'confirmed' then now() else null end,
         decline_reason = case when p_status = 'declined'
                               then nullif(btrim(left(p_reason, 300)), '') end
   where id = p_assignment
  returning * into v_row;
  return v_row;
end;
$$;

grant execute on function
  public.respond_assignment(uuid, public.assignment_status, text)
to authenticated;

-- La notifica del rifiuto porta il motivo, se c'è.
CREATE OR REPLACE FUNCTION public.notify_on_assignment_declined()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_date date;
  v_name text;
begin
  if new.status <> 'declined' or old.status = 'declined' then
    return new;
  end if;
  select s.date into v_date from public.shifts s where s.id = new.shift_id;
  select m.display_name into v_name
    from public.venue_members vm join public.workspace_members m on m.id = vm.member_id
   where vm.id = new.venue_member_id;

  perform private.notify_managers(
    new.venue_id, 'shifts', 'shift_declined', 'Turno rifiutato',
    coalesce(v_name, 'Un professionista') || ' ha rifiutato il turno del ' || to_char(v_date, 'DD/MM')
      || coalesce(': «' || new.decline_reason || '»', ''),
    new.shift_id
  );
  return new;
end;
$$;
