-- Il confine d'archivio torna nelle letture della timbratura senza turno.
--
-- 20261010000000 ha ridefinito `get_staff_planning` partendo dalla versione di
-- prima dell'enforcement commerciale e ha perso il filtro
-- `private.commercial_readable_venue_ids()`: a fine archivio i dipendenti attivi
-- tornavano a leggere planning, nomi e avatar dei colleghi. Le due letture nuove
-- della stessa migration non l'hanno mai avuto. Sono DEFINER, quindi la policy
-- restrittiva su `shifts` non le copre: il confine va nel loro corpo.
--
-- In più «Timbra senza turno» si propone solo se l'azienda è operativa; un'entrata
-- già aperta resta visibile finché l'azienda è leggibile, per poterla chiudere.
--
-- Stesse firme e stessi tipi di ritorno: `create or replace` conserva i grant.
-- Il controllo di catalogo in 050_surface impedisce di riperdere il filtro.

-- Dove posso timbrare senza turno, e l'eventuale entrata aperta.
create or replace function public.get_my_unplanned_clock()
returns table (
  venue_member_id uuid, venue_id uuid, venue_name text, workspace_name text,
  roles jsonb, open_record_id uuid, clock_in_at timestamptz, role_id uuid, note text
) language sql stable security definer set search_path = '' as $$
  select vm.id, v.id, v.name, w.name,
         coalesce((select jsonb_agg(jsonb_build_object('id', vr.id, 'name', vr.name)
                                    order by vr.sort_order, vr.name)
                     from public.venue_member_roles x
                     join public.venue_roles vr on vr.id = x.role_id
                    where x.venue_member_id = vm.id and vr.archived_at is null), '[]'::jsonb),
         c.id, c.clock_in_at, c.role_id, c.note
    from public.venue_members vm
    join public.workspace_members m on m.id = vm.member_id
    join public.workspaces w on w.id = m.workspace_id and w.deleted_at is null
    join public.venues v on v.id = vm.venue_id
    left join public.shift_clock_records c
      on c.venue_member_id = vm.id and c.shift_id is null and c.voided_at is null
   where m.user_id = (select auth.uid()) and m.status = 'active' and vm.left_at is null
     and v.closed_at is null
     and v.id in (select private.commercial_readable_venue_ids())
     -- Si propone solo se l'azienda opera; spenta (o in archivio) dopo un'entrata,
     -- l'uscita resta possibile.
     and ((vm.clock_unplanned and coalesce(vm.clock_method, v.clock_method) = 'app'
           and coalesce((private.workspace_access_at(w.id, clock_timestamp())->>'can_operate')::boolean, false))
          or c.id is not null)
   order by w.name, v.name;
$$;

-- Le timbrature senza turno ancora aperte nell'azienda, per chi vede le
-- timbrature (Turni o Ore). `can_manage` dice chi può chiuderle o annullarle.
create or replace function public.get_open_unplanned_clocks(p_workspace uuid)
returns table (
  record_id uuid, venue_id uuid, venue_name text, venue_member_id uuid, member_id uuid,
  member_name text, avatar_url text, clock_in_at timestamptz, role_name text, note text,
  can_manage boolean
) language sql stable security definer set search_path = '' as $$
  select c.id, v.id, v.name, vm.id, m.id, m.display_name, p.avatar_url, c.clock_in_at,
         vr.name, c.note,
         private.can(v.id, 'hours') and not private.is_restricted_self(m.id)
    from public.shift_clock_records c
    join public.venues v on v.id = c.venue_id
    join public.venue_members vm on vm.id = c.venue_member_id
    join public.workspace_members m on m.id = vm.member_id
    left join public.profiles p on p.id = m.user_id
    left join public.venue_roles vr on vr.id = c.role_id
   where v.workspace_id = p_workspace
     and c.shift_id is null and c.voided_at is null
     and (v.id in (select private.venues_where('hours'))
          or v.id in (select private.venues_where('shifts')))
     and v.id in (select private.commercial_readable_venue_ids())
   order by c.clock_in_at;
$$;

-- I colleghi vedono il fuori turno solo quando è approvato: prima è una
-- timbratura da verificare, non un turno.
create or replace function public.get_staff_planning(p_from date, p_to date)
returns table (
  venue_id uuid, venue_name text, venue_logo_url text, shift_id uuid, title text,
  date date, start_time time, end_time time, venue_member_id uuid, member_name text,
  avatar_url text, role_name text, is_me boolean
) language sql stable security definer set search_path = '' as $$
  with me as (select (select auth.uid()) as uid),
  my_venues as (
    select v.id, v.name, v.logo_url
      from public.venue_members vm
      join public.workspace_members m on m.id = vm.member_id
      join public.venues v on v.id = vm.venue_id
      cross join me
     where m.user_id = me.uid and m.status = 'active' and vm.left_at is null
       and v.staff_sees_planning and v.closed_at is null
  )
  select mv.id, mv.name, mv.logo_url, s.id, s.title, s.date, s.start_time, s.end_time,
         vm.id, m.display_name, p.avatar_url, r.name,
         m.user_id is not distinct from me.uid
    from public.shifts s
    join my_venues mv on mv.id = s.venue_id
    cross join me
    left join public.shift_assignments a on a.shift_id = s.id and a.status in ('assigned', 'confirmed')
    -- Chi è uscito dalla sede non lavorerà quel turno: il turno resta, la persona no.
    left join public.venue_members vm on vm.id = a.venue_member_id and vm.left_at is null
    left join public.workspace_members m on m.id = vm.member_id
    left join public.profiles p on p.id = m.user_id
    left join public.venue_roles r on r.id = a.role_id
   where s.venue_id in (select private.commercial_readable_venue_ids()) and s.status <> 'cancelled'
     and s.date >= p_from and s.date <= least(p_to, p_from + 62)
     and (not s.unplanned or exists (
       select 1 from public.shift_assignments x
        where x.shift_id = s.id and x.attendance_reviewed_at is not null))
   order by s.date, s.start_time, s.id, m.display_name;
$$;
