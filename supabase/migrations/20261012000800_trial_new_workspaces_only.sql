-- C18 (audit 2026-10-12, decisione D2 del 2026-10-16): la prova di 30 giorni
-- spetta solo alle aziende nuove, come dice docs/MONETIZATION.md. Prima bastava
-- non aver mai avuto una prova: un'azienda in archivio dopo una transizione o una
-- concessione a tempo poteva riattivarsi da sola per 30 giorni.
--
-- Copia integrale dell'ultima definizione (20261005000300_commercial_rpc_guards.sql)
-- con il solo controllo aggiunto, dopo il ritorno idempotente e `trial_already_used`.
-- Stessa firma: CREATE OR REPLACE conserva i privilegi.

CREATE OR REPLACE FUNCTION public.start_workspace_trial(p_workspace uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Solo aziende nuove: qualunque periodo già registrato (transizione,
  -- concessione, gratuità, anche programmato o revocato) esclude la prova.
  if exists (select 1 from public.workspace_access_periods p where p.workspace_id = p_workspace) then
    raise exception 'trial_not_eligible' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.venues v
     where v.workspace_id = p_workspace and v.closed_at is null
  ) then
    raise exception 'trial_requires_open_venue' using errcode = '23514';
  end if;

  if (select count(*) from public.venues where workspace_id=p_workspace and closed_at is null) > 1 then
    raise exception 'workspace_venue_capacity' using errcode = '23514';
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
$function$
;
