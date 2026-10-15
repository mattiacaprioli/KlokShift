-- C19: lo stesso ordine delle mutazioni di capacità, azienda prima delle righe figlie.
-- Il lock non richiede operatività: uscita e revoca restano possibili in archivio.
create or replace function private.leave_workspace(p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_commercial_workspace(
    (select m.workspace_id from public.workspace_members m where m.id = p_member)
  );

  update public.venue_members set left_at = now()
   where member_id = p_member and left_at is null;

  update public.workspace_members set
    status = 'left', left_at = now(),
    authority = 'none', scope = 'all',
    can_shifts = false, can_staff = false, can_hours = false,
    can_documents = false, can_venue = false
  where id = p_member;

  delete from public.member_scope where member_id = p_member;
  delete from public.member_invites where member_id = p_member;
end;
$$;
revoke all on function private.leave_workspace(uuid) from public, anon, authenticated;

-- Non dipendere dai soli privilegi di default per queste RPC pubbliche.
revoke all on function
  public.set_member_clock_unplanned(uuid, boolean),
  public.clock_punch_unplanned(uuid, text, uuid, text),
  public.close_unplanned_clock(uuid, timestamptz, text),
  public.void_unplanned_clock(uuid, text),
  public.get_my_unplanned_clock(),
  public.get_open_unplanned_clocks(uuid)
from public, anon;

grant execute on function
  public.set_member_clock_unplanned(uuid, boolean),
  public.clock_punch_unplanned(uuid, text, uuid, text),
  public.close_unplanned_clock(uuid, timestamptz, text),
  public.void_unplanned_clock(uuid, text),
  public.get_my_unplanned_clock(),
  public.get_open_unplanned_clocks(uuid)
to authenticated;
