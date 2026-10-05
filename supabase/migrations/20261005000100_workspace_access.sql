-- M03a: fondazione commerciale, senza attivare il rollout operativo.
--
-- Non cambia workspaces.plan, l'oracolo dei permessi o le RPC operative.
-- Le aziende preesistenti richiedono classificazione esplicita: non ricevono
-- prove, pagamenti o gratuità permanenti dedotti dal vecchio free/pro.
-- Il read model non costituisce ancora enforcement di RPC/RLS/Storage.

create table public.workspace_commercial_state (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  trial_started_at timestamptz,
  migration_review_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_commercial_trial_finite check (
    trial_started_at is null or isfinite(trial_started_at)
  )
);
alter table public.workspace_commercial_state enable row level security;
create trigger workspace_commercial_state_updated_at
  before update on public.workspace_commercial_state
  for each row execute function public.update_updated_at();

create table public.workspace_access_periods (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in (
    'trial', 'complimentary_lifetime', 'complimentary_temporary', 'transition'
  )),
  plan text not null check (plan in ('base', 'team')),
  venue_limit integer not null check (venue_limit >= 1),
  starts_at timestamptz not null,
  ends_at timestamptz,
  revoked_at timestamptz,
  reason text not null check (btrim(reason) <> ''),
  created_at timestamptz not null default now(),
  constraint workspace_access_period_dates check (
    isfinite(starts_at)
    and (
      (kind = 'complimentary_lifetime' and ends_at is null)
      or (
        kind <> 'complimentary_lifetime' and ends_at is not null
        and isfinite(ends_at) and ends_at > starts_at
      )
    )
    and (revoked_at is null or isfinite(revoked_at))
  )
);
alter table public.workspace_access_periods enable row level security;
create index workspace_access_periods_workspace_idx
  on public.workspace_access_periods (workspace_id, starts_at desc);
-- Revocare una prova non permette di ottenerne un'altra.
create unique index workspace_access_periods_trial_uq
  on public.workspace_access_periods (workspace_id) where kind = 'trial';

revoke all on public.workspace_commercial_state, public.workspace_access_periods
  from public, anon, authenticated;
grant select, insert, update, delete
  on public.workspace_commercial_state, public.workspace_access_periods
  to service_role;

-- Solo metadati di migrazione; nessuna data commerciale viene inventata.
insert into public.workspace_commercial_state (workspace_id, migration_review_required)
select w.id, true from public.workspaces w;

-- Valutazione interna: p_at serve alle fixture e alle operazioni server.
-- Non è esposto al client, che riceve soltanto la valutazione a now().
create function private.workspace_access_at(p_workspace uuid, p_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_period record;
  v_state text := 'setup';
  v_source text;
  v_plan text;
  v_from timestamptz;
  v_until timestamptz;
  v_archive_until timestamptz;
  v_attendance_until timestamptz;
  v_venue_limit integer;
  v_people_limit integer;
  v_people bigint := 0;
  v_venues bigint := 0;
  v_deleted boolean;
  v_migration_pending boolean := false;
begin
  if p_at is null or not isfinite(p_at) then
    raise exception 'invalid_access_period' using errcode = '23514';
  end if;

  select w.deleted_at is not null into v_deleted
    from public.workspaces w where w.id = p_workspace;
  if not found or v_deleted then
    v_state := 'expired';
  else
    select count(*) into v_venues
      from public.venues v
     where v.workspace_id = p_workspace and v.closed_at is null;
    select count(distinct m.id) into v_people
      from public.workspace_members m
      join public.venue_members vm on vm.member_id = m.id
      join public.venues v on v.id = vm.venue_id
     where m.workspace_id = p_workspace
       and m.status in ('active', 'invited')
       and vm.left_at is null and v.closed_at is null;

    select s.migration_review_required into v_migration_pending
      from public.workspace_commercial_state s where s.workspace_id = p_workspace;

    -- Prima un periodo operativo. Una concessione permanente operativa prevale;
    -- altrimenti vince il termine effettivo più lontano. Se sono tutti terminati,
    -- si usa l'ultimo termine effettivo, senza sommare capacità di periodi diversi.
    -- Una revoca prima dell'inizio non crea un periodo operativo né un archivio.
    with effective_periods as (
      select p.*,
             case
               when p.revoked_at is null then p.ends_at
               when p.ends_at is null then p.revoked_at
               else least(p.ends_at, p.revoked_at)
             end as effective_end
        from public.workspace_access_periods p
       where p.workspace_id = p_workspace and p.starts_at <= p_at
    )
    select p.* into v_period
      from effective_periods p
     where p.effective_end is null or p.effective_end > p.starts_at
     order by (p.effective_end is null or p_at < p.effective_end) desc,
              (p.kind = 'complimentary_lifetime'
                and (p.effective_end is null or p_at < p.effective_end)) desc,
              p.effective_end desc nulls first,
              p.starts_at desc, p.created_at desc, p.id desc
     limit 1;

    if found then
      v_source := v_period.kind;
      v_plan := v_period.plan;
      v_from := v_period.starts_at;
      v_until := v_period.effective_end;
      v_venue_limit := v_period.venue_limit;
      v_people_limit := case when v_plan = 'base' then 30 else null end;

      if v_until is not null then
        -- Dodici mesi di calendario nell'ora italiana, indipendenti dalla TZ
        -- della connessione, compresi anno bisestile e cambi di ora legale.
        v_archive_until := (
          (v_until at time zone 'Europe/Rome') + interval '12 months'
        ) at time zone 'Europe/Rome';
        -- Finestra di rettifica distinta: sette giorni, non un'altra concessione.
        v_attendance_until := v_until + interval '168 hours';
      end if;

      if v_until is null or p_at < v_until then
        v_state := 'operational';
      elsif p_at < v_archive_until then
        v_state := 'archive';
      else
        v_state := 'expired';
      end if;
    elsif coalesce(v_migration_pending, false) then
      v_state := 'migration_pending';
    end if;
  end if;

  return jsonb_build_object(
    'workspace_id', p_workspace,
    'state', v_state,
    'source', v_source,
    'plan', v_plan,
    'operational_from', v_from,
    'operational_until', v_until,
    'archive_until', v_archive_until,
    'attendance_until', v_attendance_until,
    'can_operate', v_state = 'operational',
    'can_read', v_state <> 'expired',
    'can_complete_attendance', v_state = 'operational'
      or (v_state = 'archive' and p_at < v_attendance_until),
    'limits', jsonb_build_object('people', v_people_limit, 'venues', v_venue_limit),
    'usage', jsonb_build_object('people', v_people, 'venues', v_venues)
  );
end;
$$;
revoke all on function private.workspace_access_at(uuid, timestamptz)
  from public, anon, authenticated;

-- Read model autenticato: nessuna data as-of o informazione economica client.
create function public.get_workspace_access(p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_authority public.member_authority;
  v_access jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select m.authority into v_authority
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id and w.deleted_at is null
   where m.workspace_id = p_workspace and m.user_id = v_uid and m.status = 'active';
  if not found then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  v_access := private.workspace_access_at(p_workspace, now());
  -- I professionisti ricevono il diritto dell'azienda, non i conteggi globali.
  if v_authority = 'none' then
    v_access := jsonb_set(v_access, '{usage}', 'null'::jsonb);
  end if;
  return v_access;
end;
$$;
revoke all on function public.get_workspace_access(uuid) from public, anon, authenticated;
grant execute on function public.get_workspace_access(uuid) to authenticated;

-- Unica attivazione della prova pubblica: titolare, prima sede pronta,
-- server clock, Team/una sede per trenta giorni. Il retry restituisce lo stesso
-- periodo, anche dopo la sua fine, senza cambiare date o revoche.
create function public.start_workspace_trial(p_workspace uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_period uuid;
  v_started_at timestamptz;
  v_review_required boolean;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.owns_workspace(p_workspace) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  -- Lo stesso lock sarà usato per capacità, variazioni e classificazione.
  perform 1 from public.workspaces w
   where w.id = p_workspace and w.deleted_at is null for update;
  if not found or not private.owns_workspace(p_workspace) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  insert into public.workspace_commercial_state (workspace_id)
  values (p_workspace) on conflict (workspace_id) do nothing;
  select s.trial_started_at, s.migration_review_required
    into v_started_at, v_review_required
    from public.workspace_commercial_state s where s.workspace_id = p_workspace;
  if v_review_required then
    raise exception 'commercial_migration_required' using errcode = '23514';
  end if;

  select p.id into v_period from public.workspace_access_periods p
   where p.workspace_id = p_workspace and p.kind = 'trial';
  if found then
    return v_period;
  end if;
  -- La data rimane una lapide anche se il servizio ha rimosso il periodo.
  if v_started_at is not null then
    raise exception 'trial_already_used' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.venues v
     where v.workspace_id = p_workspace and v.closed_at is null
  ) then
    raise exception 'trial_requires_open_venue' using errcode = '23514';
  end if;

  insert into public.workspace_access_periods (
    workspace_id, kind, plan, venue_limit, starts_at, ends_at, reason
  ) values (
    p_workspace, 'trial', 'team', 1, v_now, v_now + interval '720 hours',
    'Prova iniziale di 30 giorni senza carta'
  ) returning id into v_period;
  update public.workspace_commercial_state
     set trial_started_at = v_now where workspace_id = p_workspace;
  return v_period;
end;
$$;
revoke all on function public.start_workspace_trial(uuid) from public, anon, authenticated;
grant execute on function public.start_workspace_trial(uuid) to authenticated;

-- Porta riservata al servizio fidato. Non accetta pagamenti presunti o trial:
-- i periodi paganti verranno introdotti soltanto con il flusso webhook verificato.
-- Questo blocco non espone ancora azioni amministrative al browser del fondatore.
create function public.grant_workspace_access(
  p_workspace uuid,
  p_kind text,
  p_plan text,
  p_venue_limit integer,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_kind is null or p_kind not in (
    'complimentary_lifetime', 'complimentary_temporary', 'transition'
  ) then
    raise exception 'invalid_access_kind' using errcode = '23514';
  end if;
  if p_plan is null or p_plan not in ('base', 'team') then
    raise exception 'invalid_access_plan' using errcode = '23514';
  end if;
  if p_venue_limit is null or p_venue_limit < 1 then
    raise exception 'invalid_access_capacity' using errcode = '23514';
  end if;
  if p_starts_at is null or not isfinite(p_starts_at)
     or (p_kind = 'complimentary_lifetime' and p_ends_at is not null)
     or (p_kind <> 'complimentary_lifetime' and (
       p_ends_at is null or not isfinite(p_ends_at) or p_ends_at <= p_starts_at
     )) then
    raise exception 'invalid_access_period' using errcode = '23514';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'access_reason_required' using errcode = '23514';
  end if;

  perform 1 from public.workspaces w
   where w.id = p_workspace and w.deleted_at is null for update;
  if not found then
    raise exception 'workspace_not_found' using errcode = '23514';
  end if;

  insert into public.workspace_access_periods (
    workspace_id, kind, plan, venue_limit, starts_at, ends_at, reason
  ) values (
    p_workspace, p_kind, p_plan, p_venue_limit, p_starts_at, p_ends_at, btrim(p_reason)
  ) returning id into v_id;
  -- Una concessione esplicita del servizio costituisce classificazione.
  insert into public.workspace_commercial_state (workspace_id, migration_review_required)
  values (p_workspace, false)
  on conflict (workspace_id) do update set migration_review_required = false;
  return v_id;
end;
$$;
revoke all on function public.grant_workspace_access(
  uuid, text, text, integer, timestamptz, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.grant_workspace_access(
  uuid, text, text, integer, timestamptz, timestamptz, text
) to service_role;
