-- Approvare le timbrature senza aprire i turni uno a uno (decisione del 30/10).
--
-- Con la timbratura le ore contano solo da una timbratura approvata (B02), e
-- finora l'unico modo era aprire ogni turno finito. I concorrenti alleggeriscono
-- in due modi, e qui ci sono tutti e due:
--
-- 1. `approve_regular_clock_records`: «approva tutte quelle in orario» per un
--    periodo, dalla pagina Ore. Un tocco, ma lo dà una persona (come l'«Approve
--    All» di Homebase o la selezione multipla di Planday).
-- 2. `venues.clock_auto_approve`: la sede sceglie di far approvare da sole le
--    timbrature in orario, all'uscita (come 7shifts e Deputy). Spenta di
--    default; tutto quello che non è in orario resta da guardare a mano.
--
-- «In orario» è lo stesso criterio del blocco già esistente nel turno
-- (`isRegularPendingClock` in src/features/clock/hours.ts, gemello **manuale**
-- di `private.clock_record_is_regular`): timbratura dall'app completa, senza
-- correzioni, su un turno pianificato e attivo, con le ore conteggiate (al
-- quarto d'ora) uguali a quelle del turno. L'automatico, in più, non tocca mai
-- le ore di un collaboratore: chi gestisce non approva le proprie.
--
-- Un'approvazione automatica si riconosce: `attendance_auto_approved` vero e
-- nessun `attendance_reviewed_by`. Ogni scrittura umana sulla revisione (una
-- correzione, un'approvazione, un annullamento) lo spegne da sé.

alter table public.venues add column clock_auto_approve boolean not null default false;
alter table public.shift_assignments
  add column attendance_auto_approved boolean not null default false;

-- Rivista da qualcuno, oppure approvata in automatico: mai a metà.
alter table public.shift_assignments drop constraint shift_assignments_attendance_review_ck;
alter table public.shift_assignments add constraint shift_assignments_attendance_review_ck check (
  (attendance_reviewed_at is null) = (attendance_reviewed_by is null and not attendance_auto_approved)
);

create function private.clear_auto_approved()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Le funzioni che rivedono le presenze scrivono `attendance_reviewed_by` (una
  -- persona) o lo azzerano: in entrambi i casi la revisione non è più automatica.
  if new.attendance_reviewed_by is not null or new.attendance_reviewed_at is null then
    new.attendance_auto_approved := false;
  end if;
  return new;
end;
$$;
revoke all on function private.clear_auto_approved() from public, anon, authenticated;

create trigger shift_assignments_clear_auto_approved
  before update of attendance_reviewed_at, attendance_reviewed_by on public.shift_assignments
  for each row execute function private.clear_auto_approved();

-- La timbratura è «in orario»? Vedi il commento in testa: gemello manuale di
-- `isRegularPendingClock`.
create function private.clock_record_is_regular(p_record uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select r.method = 'app'
       and r.voided_at is null
       and a.status in ('assigned', 'confirmed')
       and a.attendance_reviewed_at is null
       and s.status <> 'cancelled'
       and not s.unplanned
       and t.clock_out_at is not null
       and not exists (select 1 from public.shift_clock_corrections c where c.clock_record_id = r.id)
       and private.clock_record_counted_hours(r.id)
           = public.shift_counted_hours(s.start_time, s.end_time, s.break_minutes,
                                        coalesce(s.break_paid, v.break_paid))
      from public.shift_clock_records r
      join public.shift_assignments a on a.id = r.assignment_id
      join public.shifts s on s.id = r.shift_id
      join public.venues v on v.id = r.venue_id
      cross join lateral private.clock_record_times(r.id) t
     where r.id = p_record), false);
$$;
revoke all on function private.clock_record_is_regular(uuid) from public, anon, authenticated;

-- All'uscita: se la sede lo ha scelto e la timbratura è in orario, le ore
-- contano subito. Stessa scrittura di `approve_clock_record`, senza revisore.
create function private.auto_approve_clock()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.shift_id is null then return new; end if;
  if not exists (select 1 from public.venues v where v.id = new.venue_id and v.clock_auto_approve) then
    return new;
  end if;
  if exists (select 1 from public.venue_members vm
               join public.workspace_members m on m.id = vm.member_id
              where vm.id = new.venue_member_id and m.authority = 'collaborator') then
    return new;
  end if;
  if not private.clock_record_is_regular(new.id) then return new; end if;
  update public.shift_assignments x set
    worked_hours = private.clock_record_counted_hours(new.id),
    hours_source = 'clock',
    attendance_reviewed_at = now(),
    attendance_reviewed_by = null,
    attendance_auto_approved = true
  where x.id = new.assignment_id and x.attendance_reviewed_at is null;
  return new;
end;
$$;
revoke all on function private.auto_approve_clock() from public, anon, authenticated;

create trigger shift_clock_records_auto_approve
  after update of clock_out_at on public.shift_clock_records
  for each row when (old.clock_out_at is null and new.clock_out_at is not null)
  execute function private.auto_approve_clock();

-- L'interruttore della sede: chi ha «Ore», come il metodo di timbratura.
create function public.set_venue_clock_auto_approve(p_venue uuid, p_on boolean)
returns public.venues language plpgsql security definer set search_path = '' as $$
declare v_row public.venues;
begin
  perform private.assert_workspace_operational(private.venue_workspace(p_venue));
  if not private.can(p_venue, 'hours') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.venues set clock_auto_approve = coalesce(p_on, false) where id = p_venue
  returning * into v_row;
  if v_row.id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return v_row;
end;
$$;

-- «Approva tutte quelle in orario» per un periodo (date dei turni, estremi
-- compresi). Con `p_dry_run` conta e basta: il numero sul pulsante. Ogni riga
-- passa da `approve_clock_record`, con tutti i suoi controlli; qui si sceglie
-- solo quali, fra quelle che chi chiama può approvare.
create function public.approve_regular_clock_records(
  p_workspace uuid, p_from date, p_to date, p_dry_run boolean default false
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- Lo stesso limite del periodo libero della pagina Ore (MAX_RANGE_DAYS).
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  select coalesce(array_agg(a.id order by s.date, s.start_time, a.id), '{}') into v_ids
    from public.shift_clock_records r
    join public.shift_assignments a on a.id = r.assignment_id
    join public.shifts s on s.id = r.shift_id
    join public.venues v on v.id = r.venue_id
    join public.venue_members vm on vm.id = a.venue_member_id
   where v.workspace_id = p_workspace
     and s.date between p_from and p_to
     and r.voided_at is null
     and a.attendance_reviewed_at is null
     and private.can(v.id, 'hours')
     and not private.is_restricted_self(vm.member_id)
     and private.clock_record_is_regular(r.id);
  if p_dry_run then return coalesce(array_length(v_ids, 1), 0); end if;
  foreach v_id in array v_ids loop
    perform public.approve_clock_record(v_id);
  end loop;
  return coalesce(array_length(v_ids, 1), 0);
end;
$$;

revoke all on function public.set_venue_clock_auto_approve(uuid, boolean),
  public.approve_regular_clock_records(uuid, date, date, boolean) from public, anon, authenticated;
grant execute on function public.set_venue_clock_auto_approve(uuid, boolean),
  public.approve_regular_clock_records(uuid, date, date, boolean) to authenticated;

-- L'export completo dice se un'approvazione è stata automatica. Si tocca solo
-- la riga della presenza, come nelle riscritture del glossario.
do $mig$
declare src text;
begin
  src := pg_get_functiondef('public.export_workspace_data'::regproc);
  if position('''reviewed_at'', a.attendance_reviewed_at)' in src) = 0 then
    raise exception 'clock_auto_approve: export_workspace_data è cambiata, aggiornare la riscrittura';
  end if;
  src := replace(src, '''reviewed_at'', a.attendance_reviewed_at)',
    '''reviewed_at'', a.attendance_reviewed_at, ''auto_approved'', a.attendance_auto_approved)');
  execute src;
end
$mig$;
