-- Restringe la lettura dei turni: prima "waiter reads non-cancelled" permetteva a
-- CHIUNQUE (anche anon) di leggere via API tutti i turni non annullati, inclusi
-- i turni interni di altri locali. Ora: marketplace visibile agli autenticati,
-- turni interni solo a chi vi è assegnato (il ristoratore proprietario resta
-- coperto dalla policy "shifts: manager crud own").

-- Helper DEFINER: evita la ricorsione RLS (la policy di shifts interrogherebbe
-- shift_assignments, la cui policy owner interroga a sua volta shifts).
-- Controlla solo l'utente corrente: nessun parametro waiter arbitrario.
create or replace function public.is_my_assigned_shift(p_shift uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.shift_assignments a
    join public.staff_members sm on sm.id = a.staff_member_id
    where a.shift_id = p_shift
      and sm.waiter_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_my_assigned_shift(uuid) from anon, public;
grant execute on function public.is_my_assigned_shift(uuid) to authenticated;

drop policy if exists "shifts: waiter reads non-cancelled" on public.shifts;

create policy "shifts: read marketplace or assigned"
  on public.shifts for select
  to authenticated
  using (
    status <> 'cancelled'
    and (
      kind = 'marketplace'
      or public.is_my_assigned_shift(id)
    )
  );
