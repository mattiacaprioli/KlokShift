-- Passare un turno da una persona a un'altra, in un colpo solo.
--
-- Serve al drag & drop del Planning (vista "persone"): si trascina il turno
-- dalla riga di chi non può alla riga di chi lo copre. Finora l'unica strada
-- era `updateInternalShift`, che riscrive l'intero turno — ruoli richiesti
-- compresi — per spostare una persona.
--
-- ⚠️ Perché non un semplice `update shift_assignments set staff_member_id`:
-- `notify_on_assignment` è AFTER INSERT (20260712075549) e
-- `notify_on_assignment_removed` è AFTER DELETE (20260909193312). Con un UPDATE
-- non scatterebbe **nessuna delle due**: chi esce non saprebbe di essere fuori,
-- chi entra non saprebbe di essere dentro. In più chi entra erediterebbe lo
-- `status` di chi esce (magari 'confirmed', cioè "ha confermato" un turno che
-- non ha mai visto) e le sue `worked_hours`. Quindi delete + insert, dentro la
-- stessa transazione: le notifiche partono, e la riga di chi entra nasce
-- pulita ('assigned', ore a null).
--
-- `positions_filled` si aggiusta da sé: `sync_internal_positions_filled`
-- (20260715130000) gira su entrambi gli statement e il totale non cambia.
--
-- SECURITY INVOKER di proposito: la policy "shift_assignments: owner all" è
-- già la regola giusta (proprietario del locale del turno) e non va riscritta
-- qui. Restano i due controlli che la policy non copre.
create or replace function public.reassign_shift_assignment(
  p_assignment uuid,
  p_staff_member uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_shift uuid;
  v_old   uuid;
  v_new   uuid;
begin
  select shift_id, staff_member_id into v_shift, v_old
    from public.shift_assignments
   where id = p_assignment;

  -- Inesistente, oppure nascosta dalla RLS: per chi chiama è lo stesso.
  if not found then
    raise exception 'Assegnazione non trovata';
  end if;

  -- Trascinata sulla stessa persona: niente da fare, e nessuna notifica.
  if v_old = p_staff_member then
    return p_assignment;
  end if;

  -- La policy guarda il turno, non lo staff member: senza questo controllo si
  -- potrebbe assegnare un turno a una persona dell'organico di un altro locale.
  if not exists (
    select 1
      from public.staff_members sm
      join public.shifts s on s.id = v_shift
     where sm.id = p_staff_member
       and sm.venue_id = s.venue_id
  ) then
    raise exception 'La persona non fa parte dello staff del locale';
  end if;

  -- unique (shift_id, staff_member_id): meglio dirlo con parole nostre che
  -- lasciar salire un 23505 fino all'interfaccia.
  if exists (
    select 1
      from public.shift_assignments
     where shift_id = v_shift
       and staff_member_id = p_staff_member
  ) then
    raise exception 'Questa persona è già su questo turno';
  end if;

  delete from public.shift_assignments where id = p_assignment;

  insert into public.shift_assignments (shift_id, staff_member_id)
  values (v_shift, p_staff_member)
  returning id into v_new;

  return v_new;
end;
$$;

revoke execute on function public.reassign_shift_assignment(uuid, uuid) from anon, public;
grant execute on function public.reassign_shift_assignment(uuid, uuid) to authenticated;
