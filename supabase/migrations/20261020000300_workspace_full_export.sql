-- M11: export completo dei dati aziendali (restituzione), anche in archivio.
--
-- Decisioni del 20/10 (plans/MONETIZATION-AND-FOUNDER-DASHBOARD.md, M11):
--   - contiene tutto lo storico di lavoro: sedi, persone (scheda, sedi,
--     contratto, nota HR), turni, presenze (conferma, timbrature, pausa, ore
--     approvate), assenze (con ore riconosciute) e l'elenco dei documenti;
--   - niente chat: sono conversazioni fra persone, il titolare non le legge tutte;
--   - lo scaricano il titolare e i collaboratori con «Organico» e «Ore» su tutte
--     le sedi; i documenti solo chi può già vederli (titolare o «Documenti»).
--     Gli altri restano agli export della pagina Ore.
-- Vale finché l'azienda è consultabile (`can_read`): in archivio sì, dopo la
-- scadenza no. Il pacchetto ZIP lo compone il browser; i file dei documenti li
-- scarica con le policy Storage esistenti.

create function public.export_workspace_data(p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.workspace_members;
  w public.workspaces;
  v_docs boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into me from public.workspace_members
   where workspace_id = p_workspace and user_id = (select auth.uid()) and status = 'active';
  if not found or not (me.authority = 'owner' or (me.authority = 'collaborator'
       and me.can_staff and me.can_hours and me.scope = 'all')) then
    raise exception 'export_not_allowed' using errcode = '42501';
  end if;
  select * into w from public.workspaces where id = p_workspace;
  if w.data_deleted_at is not null
     or coalesce((private.workspace_access_at(p_workspace, now()) ->> 'can_read')::boolean, false) is not true then
    raise exception 'workspace_not_readable' using errcode = '42501';
  end if;
  v_docs := me.authority = 'owner' or me.can_documents;

  return jsonb_build_object(
    'generated_at', now(),
    'workspace', jsonb_build_object('id', w.id, 'name', w.name, 'created_at', w.created_at),
    'documents_included', v_docs,
    'venues', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', v.name, 'address', v.address, 'city', v.city,
        'created_at', v.created_at, 'closed_at', v.closed_at) order by v.created_at, v.id), '[]'::jsonb)
      from public.venues v where v.workspace_id = p_workspace),
    'people', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', m.display_name, 'email', m.email, 'phone', m.phone,
        'authority', m.authority, 'status', m.status, 'joined_at', m.created_at, 'left_at', m.left_at,
        'contract_hours', hr.contract_hours, 'contract_period', hr.contract_period, 'hr_note', hr.note,
        'venues', (select coalesce(jsonb_agg(jsonb_build_object(
              'venue', v.name, 'employment_type', vm.employment_type, 'left_at', vm.left_at,
              'roles', (select coalesce(string_agg(r.name, ', ' order by r.sort_order, r.name), '')
                          from public.venue_member_roles vr join public.venue_roles r on r.id = vr.role_id
                         where vr.venue_member_id = vm.id))
              order by v.created_at, v.id), '[]'::jsonb)
            from public.venue_members vm join public.venues v on v.id = vm.venue_id
           where vm.member_id = m.id))
        order by m.display_name, m.id), '[]'::jsonb)
      from public.workspace_members m left join public.member_hr hr on hr.member_id = m.id
     where m.workspace_id = p_workspace),
    'shifts', (select coalesce(jsonb_agg(jsonb_build_object(
        'date', s.date, 'venue', v.name, 'title', s.title, 'start_time', s.start_time, 'end_time', s.end_time,
        'break_minutes', s.break_minutes, 'break_paid', s.break_paid, 'status', s.status,
        'unplanned', s.unplanned, 'positions_total', s.positions_total, 'description', s.description)
        order by s.date, s.start_time, v.name, s.id), '[]'::jsonb)
      from public.shifts s join public.venues v on v.id = s.venue_id where v.workspace_id = p_workspace),
    'attendance', (select coalesce(jsonb_agg(x order by x ->> 'date', x ->> 'start_time', x ->> 'person'), '[]'::jsonb) from (
      select jsonb_build_object(
        'date', s.date, 'venue', v.name, 'shift', s.title, 'start_time', s.start_time, 'end_time', s.end_time,
        'person', m.display_name, 'role', r.name, 'status', a.status, 'confirmed_at', a.confirmed_at,
        'clock_method', c.method,
        'clock_in_at', coalesce(k.corrected_in_at, c.clock_in_at),
        'clock_out_at', coalesce(k.corrected_out_at, c.clock_out_at),
        'clock_break_minutes', case when c.id is not null
          then (select b.minutes from private.clock_record_break(c.id) b) end,
        'corrected', k.clock_record_id is not null, 'correction_reason', k.reason,
        'worked_hours', a.worked_hours, 'hours_source', a.hours_source,
        'reviewed_at', a.attendance_reviewed_at) as x
        from public.shift_assignments a
        join public.shifts s on s.id = a.shift_id
        join public.venues v on v.id = s.venue_id
        join public.venue_members vm on vm.id = a.venue_member_id
        join public.workspace_members m on m.id = vm.member_id
        left join public.venue_roles r on r.id = a.role_id
        left join lateral (select * from public.shift_clock_records c
                            where c.assignment_id = a.id and c.voided_at is null
                            order by c.clock_in_at desc limit 1) c on true
        left join lateral (select * from public.shift_clock_corrections k
                            where k.clock_record_id = c.id order by k.created_at desc limit 1) k on true
       where v.workspace_id = p_workspace) t),
    'absences', (select coalesce(jsonb_agg(jsonb_build_object(
        'person', m.display_name, 'kind', ab.kind, 'start_date', ab.start_date, 'end_date', ab.end_date,
        'start_time', ab.start_time, 'end_time', ab.end_time, 'status', ab.status,
        'recognized_minutes', (select coalesce(sum(h.minutes), 0) from public.absence_hour_credits h
                                where h.absence_id = ab.id),
        'inps_protocol', ab.inps_protocol, 'note', ab.note, 'resolution_note', ab.resolution_note,
        'created_at', ab.created_at)
        order by ab.start_date, m.display_name, ab.id), '[]'::jsonb)
      from public.staff_absences ab join public.workspace_members m on m.id = ab.member_id
     where m.workspace_id = p_workspace),
    'documents', case when v_docs then (select coalesce(jsonb_agg(jsonb_build_object(
        'person', m.display_name, 'name', d.name, 'mime_type', d.mime_type, 'size_bytes', d.size_bytes,
        'expires_at', d.expires_at, 'created_at', d.created_at, 'storage_path', d.storage_path)
        order by m.display_name, d.created_at, d.id), '[]'::jsonb)
      from public.staff_documents d join public.workspace_members m on m.id = d.member_id
     where m.workspace_id = p_workspace) else null end
  );
end;
$$;
revoke all on function public.export_workspace_data(uuid) from public, anon, authenticated;
grant execute on function public.export_workspace_data(uuid) to authenticated;
