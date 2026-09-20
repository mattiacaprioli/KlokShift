-- Mantiene shifts.positions_filled = numero di candidature 'accepted' del turno.
-- SECURITY DEFINER perché anche un cameriere (senza grant UPDATE su shifts) può
-- innescare il ricalcolo ritirando/modificando la propria candidatura.
create or replace function public.sync_positions_filled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_shift uuid := coalesce(new.shift_id, old.shift_id);
begin
  update public.shifts s
  set positions_filled = (
    select count(*)
    from public.applications a
    where a.shift_id = affected_shift
      and a.status = 'accepted'
  )
  where s.id = affected_shift;
  return coalesce(new, old);
end;
$$;

drop trigger if exists applications_sync_positions on public.applications;
create trigger applications_sync_positions
after insert or update or delete on public.applications
for each row execute function public.sync_positions_filled();

-- È una funzione di trigger (invocata dal sistema, non serve EXECUTE per chi
-- innesca la DML). Revochiamo EXECUTE così PostgREST non la espone come RPC
-- SECURITY DEFINER ad anon/authenticated.
revoke execute on function public.sync_positions_filled() from anon, authenticated, public;
