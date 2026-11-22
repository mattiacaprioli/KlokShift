-- Listino a fasce (docs/MONETIZATION.md §2, decisione del 22/11): al posto di
-- Base (30 persone) e Team (senza limite) tre fasce di persone uniche
-- nell'azienda — Base 15, Team 40, Grande (`large`) 100 — e, per le sole
-- concessioni del fondatore, il perimetro personalizzato (`custom`) senza
-- limite. La prova di 30 giorni è Grande.
--
-- Il limite e l'ordine delle fasce hanno una sola fonte: private.plan_people_limit
-- e private.plan_rank. Ogni funzione che confrontava `'team'`/`'base'` o scriveva
-- 30 è ricopiata per intero dalla sua ultima definizione, con le sole righe
-- indicate cambiate; stessa firma, quindi i privilegi restano.
--
-- Chi è già oltre il limite della sua fascia resta operativo e nessuno viene
-- tolto: la regola «cresce e supera» di private.check_commercial_capacity blocca
-- solo le aggiunte.
--
-- I prezzi sandbox di Grande arriveranno in una migration a parte, quando
-- esisteranno su Paddle: fino ad allora l'acquisto di Grande risponde
-- `billing_price_unavailable`.

-- 1. Vincoli: le fasce nuove. `custom` solo nei periodi di accesso, dove le
--    concessioni del fondatore lo usano; non si vende né si abbona.
do $$
declare
  c record;
begin
  for c in
    select t.tbl, t.col, t.allowed, k.conname
      from (values
        ('public.workspace_access_periods'::regclass, 'plan', array['base', 'team', 'large', 'custom']),
        ('private.billing_prices'::regclass, 'item', array['base', 'team', 'large', 'extra_venue']),
        ('public.billing_subscriptions'::regclass, 'plan', array['base', 'team', 'large']),
        ('public.billing_checkouts'::regclass, 'plan', array['base', 'team', 'large']),
        ('public.billing_scheduled_changes'::regclass, 'target_plan', array['base', 'team', 'large'])
      ) t (tbl, col, allowed)
      join pg_catalog.pg_attribute a on a.attrelid = t.tbl and a.attname = t.col
      join pg_catalog.pg_constraint k on k.conrelid = t.tbl and k.contype = 'c'
       and k.conkey = array[a.attnum]
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
    execute format('alter table %s add constraint %I check (%I = any (%L::text[]))',
      c.tbl, c.conname, c.col, c.allowed);
  end loop;
  -- Tutti e cinque, o il nome letto non era quello atteso.
  if (select count(*) from pg_catalog.pg_constraint k
       where k.conname in ('workspace_access_periods_plan_check', 'billing_prices_item_check',
         'billing_subscriptions_plan_check', 'billing_checkouts_plan_check',
         'billing_scheduled_changes_target_plan_check')
         and pg_catalog.pg_get_constraintdef(k.oid) like '%large%') <> 5 then
    raise exception 'plan_band_constraints_not_found';
  end if;
end $$;

-- Il registro degli interventi accetta la migrazione del listino: l'unico
-- intervento senza autore, perché lo fa questa migration e non il fondatore.
alter table private.admin_operations drop constraint admin_operations_action_check;
alter table private.admin_operations add constraint admin_operations_action_check
  check (action in ('grant_lifetime', 'set_classification', 'add_note', 'delete_data',
    'plan_band_migration'));
alter table private.admin_operations alter column actor_id drop not null;
alter table private.admin_operations add constraint admin_operations_actor_check
  check (actor_id is not null or action = 'plan_band_migration');

-- 2. Le fasce. Gemelle manuali di PLAN_BANDS lato client.
create function private.plan_people_limit(p_plan text)
returns integer language plpgsql immutable set search_path = '' as $$
begin
  case p_plan
    when 'base' then return 15;
    when 'team' then return 40;
    when 'large' then return 100;
    when 'custom' then return null;
    else raise exception 'billing_invalid_selection' using errcode = '22023';
  end case;
end;
$$;
revoke all on function private.plan_people_limit(text) from public, anon, authenticated;

-- L'ordine delle fasce, per dire aumento o riduzione. `custom` non ha rango:
-- non si compra e non si confronta.
create function private.plan_rank(p_plan text)
returns integer language plpgsql immutable set search_path = '' as $$
begin
  case p_plan
    when 'base' then return 1;
    when 'team' then return 2;
    when 'large' then return 3;
    else raise exception 'billing_invalid_selection' using errcode = '22023';
  end case;
end;
$$;
revoke all on function private.plan_rank(text) from public, anon, authenticated;

-- 3. Dati, prima delle funzioni nuove, così lo stato «prima» del registro è
--    quello di ieri (Team senza limite). Le prove nate Team diventano Grande.
--    Le concessioni Team del fondatore erano «senza limite» per scelta:
--    diventano il perimetro personalizzato, e ognuna lascia una riga nel
--    registro con lo stato prima e dopo, come un intervento del fondatore.
--
--    Base non si tocca. Controllato sul remoto il 22/11: nessun periodo non di
--    prova è su `base` (complimentary_lifetime team 1 attiva/2 in tutto,
--    complimentary_temporary team 0/1, payment_grace team 0/2, subscription
--    base 0/22 e team 0/7, trial team 1/3). Se una concessione Base fosse
--    esistita, da 30 persone sarebbe scesa in silenzio a 15: andava portata a
--    Team (40) qui, con la sua riga nel registro.
--
--    La funzione resta dopo la migration (innocua: senza righe `team` concesse
--    non converte niente) perché il banco di prova la richiama
--    (supabase/tests/rls/147_plan_bands.sql); solo postgres la esegue.
--    Restituisce quante righe ha convertito.
create function private.migrate_plan_bands()
returns integer language plpgsql set search_path = '' as $$
declare
  p record;
  v_before jsonb;
  v_after jsonb;
  v_operation uuid;
  v_at timestamptz := now();
  v_trials integer;
  v_grants integer := 0;
begin
  update public.workspace_access_periods set plan = 'large'
   where kind = 'trial' and plan = 'team';
  get diagnostics v_trials = row_count;

  for p in
    select id, workspace_id, kind from public.workspace_access_periods
     where kind in ('complimentary_lifetime', 'complimentary_temporary', 'transition') and plan = 'team'
     order by workspace_id, starts_at, id
  loop
    v_before := private.admin_workspace_snapshot(p.workspace_id);
    update public.workspace_access_periods set plan = 'custom' where id = p.id;
    v_after := private.admin_workspace_snapshot(p.workspace_id);
    v_operation := gen_random_uuid();
    insert into private.admin_operations (operation_id, actor_id, target_kind, target_id, action,
      reason, parameters, before_state, after_state, result, applied_at)
    values (v_operation, null, 'workspace', p.workspace_id, 'plan_band_migration',
      'Listino a fasce del 22/11: perimetro senza limite mantenuto',
      jsonb_build_object('period_id', p.id, 'kind', p.kind, 'from_plan', 'team', 'to_plan', 'custom'),
      v_before, v_after,
      jsonb_build_object('operation_id', v_operation, 'action', 'plan_band_migration',
        'target_id', p.workspace_id, 'applied_at', v_at, 'period_id', p.id),
      v_at);
    v_grants := v_grants + 1;
  end loop;
  return v_trials + v_grants;
end;
$$;
revoke all on function private.migrate_plan_bands() from public, anon, authenticated;

select private.migrate_plan_bands();

-- 4a. Copia integrale di 20261019000300_renewal_margin.sql: il limite di persone
--     viene dalla fascia.
create or replace function private.workspace_access_at(p_workspace uuid, p_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_period record;
  v_state text := 'setup';
  v_source text;
  v_plan text;
  v_from timestamptz;
  v_prev timestamptz;
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

    -- Prima un periodo operativo. Una concessione permanente operativa prevale,
    -- poi un abbonamento operativo; altrimenti vince il termine effettivo più
    -- lontano. Se sono tutti terminati, si usa l'ultimo termine effettivo, senza
    -- sommare capacità di periodi diversi. Una revoca prima dell'inizio non crea
    -- un periodo operativo né un archivio.
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
              (p.kind in ('subscription', 'payment_grace')
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
      v_people_limit := private.plan_people_limit(v_plan);

      -- Stesso abbonamento senza interruzioni (aumento, rinnovo, tolleranza):
      -- l'inizio è quello del primo tratto. Una ripresa dopo un vuoto no.
      if v_period.subscription_id is not null then
        loop
          select p.starts_at into v_prev
            from public.workspace_access_periods p
           where p.subscription_id = v_period.subscription_id
             and p.kind in ('subscription', 'payment_grace')
             and p.starts_at < v_from
             and (p.revoked_at is null or p.revoked_at > p.starts_at)
             and least(coalesce(p.revoked_at, p.ends_at), coalesce(p.ends_at, p.revoked_at)) >= v_from
           order by p.starts_at
           limit 1;
          exit when not found;
          v_from := v_prev;
        end loop;
      end if;

      if v_until is not null then
        -- Dodici mesi di calendario nell'ora italiana, indipendenti dalla TZ
        -- della connessione, compresi anno bisestile e cambi di ora legale.
        v_archive_until := (
          (v_until at time zone 'Europe/Rome') + interval '12 months'
        ) at time zone 'Europe/Rome';
        -- Finestra di rettifica distinta: sette giorni, non un'altra concessione.
        v_attendance_until := v_until + interval '168 hours';
      end if;

      -- Margine di rinnovo: un abbonamento attivo, senza disdetta o pausa
      -- programmata e senza rimborso, resta operativo un'ora dopo la fine del
      -- periodo mentre arriva l'avviso del rinnovo. Archivio e rettifiche
      -- contano dalla fine vera; il termine restituito è quello del margine,
      -- così il client non rilegge lo stato ogni secondo.
      if v_period.kind = 'subscription' and v_period.revoked_at is null
         and v_until is not null and p_at >= v_until and p_at < v_until + interval '1 hour'
         and exists (
           select 1 from public.billing_subscriptions b
            where b.id = v_period.subscription_id and b.status = 'active'
              and b.scheduled_change_action is null
              and b.current_period_ends_at <= v_until
              and (b.refunded_until is null or b.refunded_until < v_until)) then
        v_until := v_until + interval '1 hour';
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
    'server_now', p_at,
    'next_change_at', (select min(p.starts_at) from public.workspace_access_periods p
      where p.workspace_id = p_workspace and p.starts_at > p_at
        and (p.revoked_at is null or p.revoked_at > p.starts_at)),
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
-- 4b. Copia integrale di 20261006000100_platform_admin_reads.sql: «vicino al
--     limite» a due persone dal limite della fascia, per ogni fascia con limite.
create or replace function private.admin_workspace_flags(p_row private.admin_workspace_rows)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('code',code,'severity',severity,'at',at,'source',source)),'[]'::jsonb)
  from (values
    ('migration_pending','warning',null::timestamptz,'Stato commerciale',p_row.state='migration_pending'),
    ('commercial_data_missing','critical',null::timestamptz,'Stato commerciale',p_row.state='unavailable'),
    ('trial_ending','warning',(p_row.access->>'operational_until')::timestamptz,'Periodo prova',
      p_row.state='operational' and p_row.access->>'source'='trial' and (p_row.access->>'operational_until')::timestamptz<=now()+interval '7 days'),
    ('archive_ending','warning',(p_row.access->>'archive_until')::timestamptz,'Fine operatività + 12 mesi',
      p_row.state='archive' and (p_row.access->>'archive_until')::timestamptz<=now()+interval '30 days'),
    ('attendance_window','info',(p_row.access->>'attendance_until')::timestamptz,'Fine operatività + 7 giorni',
      p_row.state='archive' and (p_row.access->>'can_complete_attendance')::boolean),
    ('archive_expired','warning',(p_row.access->>'archive_until')::timestamptz,'Archivio commerciale',p_row.state='expired'),
    ('people_near_capacity','warning',null::timestamptz,'Conteggio commerciale aziendale',
      p_row.access#>>'{limits,people}' is not null
        and (p_row.access#>>'{usage,people}')::bigint>=(p_row.access#>>'{limits,people}')::bigint-2),
    ('people_over_capacity','critical',null::timestamptz,'Conteggio commerciale aziendale',
      (p_row.access#>>'{usage,people}')::bigint>(p_row.access#>>'{limits,people}')::bigint),
    ('venues_over_capacity','critical',null::timestamptz,'Sedi aperte aziendali',
      p_row.open_venues>(p_row.access#>>'{limits,venues}')::bigint),
    ('document_measurement_incomplete','warning',null::timestamptz,'Storage: metadata.size',p_row.document_unknown_sizes>0)
  ) f(code,severity,at,source,show) where show;
$$;
-- 4c. Copia integrale di 20261006000100_platform_admin_reads.sql: il filtro per
--     piano conosce Grande e il personalizzato.
create or replace function public.admin_list_workspaces(p_query text default '',p_state text default 'all',p_plan text default 'all',
  p_classification text default 'all',p_limit integer default 25,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_platform_admin();
  perform private.validate_admin_page(p_query,p_limit,p_offset);
  if p_state is null or p_state<>all(array['all','setup','operational','archive','expired','migration_pending','unavailable','deleted'])
    or p_plan is null or p_plan<>all(array['all','base','team','large','custom'])
    or p_classification is null or p_classification<>all(array['all','customer','internal','test','unclassified']) then
    raise exception 'admin_invalid_filter' using errcode='22023';
  end if;
  with filtered as materialized (select r.* from private.admin_workspace_rows r
    where (p_state='all' or r.state=p_state) and (p_plan='all' or r.access->>'plan'=p_plan)
      and (p_classification='all' or r.classification=p_classification)
      and (btrim(coalesce(p_query,''))='' or position(lower(btrim(p_query)) in lower(r.name))>0 or exists (
        select 1 from public.workspace_members m left join auth.users u on u.id=m.user_id
        where m.workspace_id=r.id and m.authority in ('owner','collaborator') and m.status<>'left'
          and (position(lower(btrim(p_query)) in lower(m.display_name))>0
            or position(lower(btrim(p_query)) in lower(coalesce(u.email,m.email,'')))>0))))
  select jsonb_build_object('generated_at',now(),'total',(select count(*) from filtered),'limit',p_limit,'offset',p_offset,
    'items',(select coalesce(jsonb_agg(private.admin_workspace_json(p)),'[]'::jsonb) from
      (select * from filtered order by created_at desc,id limit p_limit offset p_offset) p)) into result;
  return result;
end;
$$;
-- 4d. Copia integrale di 20261006000200_founder_concessions.sql: il fondatore
--     concede una fascia o il personalizzato, mai sotto l'organico di oggi.
create or replace function public.admin_apply_workspace_action(
  p_workspace uuid,p_action text,p_reason text,p_operation_id uuid,p_expected_revision text,
  p_plan text default null,p_venue_limit integer default null,
  p_document_limit_bytes bigint default null,p_classification text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare parameters jsonb; replay jsonb; before_state jsonb; after_state jsonb;
  result jsonb; period_id uuid; applied_at timestamptz; access jsonb;
begin
  perform private.require_platform_admin();
  if p_action is null or p_action not in ('grant_lifetime','set_classification','add_note') then
    raise exception 'admin_invalid_operation' using errcode='22023';
  end if;
  if length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then
    raise exception 'admin_reason_required' using errcode='23514';
  end if;
  if p_expected_revision is null or p_expected_revision !~ '^[0-9a-f]{32}$' then
    raise exception 'admin_revision_required' using errcode='22023';
  end if;
  parameters:=jsonb_build_object('reason',btrim(p_reason),'revision',p_expected_revision,
    'plan',p_plan,'venue_limit',p_venue_limit,'document_limit_bytes',p_document_limit_bytes,'classification',p_classification);
  replay:=private.admin_operation_replay(p_operation_id,'workspace',p_workspace,p_action,parameters);
  perform private.require_platform_admin();
  if replay is not null then return replay; end if;
  perform 1 from public.workspaces where id=p_workspace and deleted_at is null for update;
  if not found then raise exception 'admin_not_found' using errcode='P0002'; end if;
  perform private.require_platform_admin();
  if private.admin_workspace_revision(p_workspace) is distinct from p_expected_revision then
    raise exception 'admin_stale_revision' using errcode='40001';
  end if;
  before_state:=private.admin_workspace_snapshot(p_workspace);
  applied_at:=now();
  if p_action='grant_lifetime' then
    if p_plan is null or p_plan not in ('base','team','large','custom') then
      raise exception 'invalid_access_plan' using errcode='23514';
    end if;
    if p_venue_limit is null or p_venue_limit<1 or p_document_limit_bytes is null
      or p_document_limit_bytes<1 or p_document_limit_bytes>9007199254740991
      or p_classification is not null then
      raise exception 'invalid_access_capacity' using errcode='23514';
    end if;
    if not exists(select 1 from public.workspace_commercial_state where workspace_id=p_workspace) then
      raise exception 'workspace_access_unavailable' using errcode='23514';
    end if;
    -- Fail closed quando M09 introdurrà periodi provider: un flag locale
    -- non deve fermare rinnovi o promettere rimborsi di contratti paganti.
    if exists(select 1 from public.workspace_access_periods where workspace_id=p_workspace
      and kind not in ('trial','complimentary_lifetime','complimentary_temporary','transition')) then
      raise exception 'admin_provider_action_required' using errcode='23514';
    end if;
    if exists(select 1 from public.workspace_access_periods where workspace_id=p_workspace
      and starts_at>applied_at and (revoked_at is null or revoked_at>starts_at)) then
      raise exception 'admin_future_period_conflict' using errcode='23514';
    end if;
    access:=private.workspace_access_at(p_workspace,applied_at);
    if (access#>>'{usage,people}')::bigint>private.plan_people_limit(p_plan) then
      raise exception 'workspace_people_capacity' using errcode='23514';
    end if;
    if (access#>>'{usage,venues}')::bigint>p_venue_limit then
      raise exception 'workspace_venue_capacity' using errcode='23514';
    end if;
    if (before_state->>'document_unknown_sizes')::bigint>0 then
      raise exception 'admin_document_usage_unknown' using errcode='23514';
    end if;
    if (before_state->>'document_known_bytes')::numeric>p_document_limit_bytes then
      raise exception 'admin_document_capacity' using errcode='23514';
    end if;
    -- Si conserva il periodo precedente, senza sovrapporre due capacità a vita.
    update public.workspace_access_periods set revoked_at=applied_at
      where workspace_id=p_workspace and kind='complimentary_lifetime'
        and starts_at<=applied_at and (revoked_at is null or revoked_at>applied_at);
    insert into public.workspace_access_periods(workspace_id,kind,plan,venue_limit,
      document_limit_bytes,starts_at,ends_at,reason)
    values(p_workspace,'complimentary_lifetime',p_plan,p_venue_limit,p_document_limit_bytes,
      applied_at,null,btrim(p_reason)) returning id into period_id;
    update public.workspace_commercial_state set migration_review_required=false
      where workspace_id=p_workspace;
  elsif p_action='set_classification' then
    if p_classification is null or p_classification not in ('customer','internal','test','unclassified')
      or p_plan is not null or p_venue_limit is not null or p_document_limit_bytes is not null then
      raise exception 'admin_invalid_operation' using errcode='22023';
    end if;
    if p_classification='unclassified' then
      delete from private.admin_workspace_labels where workspace_id=p_workspace;
    else
      insert into private.admin_workspace_labels(workspace_id,classification,reason,updated_at)
      values(p_workspace,p_classification,btrim(p_reason),applied_at)
      on conflict(workspace_id) do update set classification=excluded.classification,
        reason=excluded.reason,updated_at=excluded.updated_at;
    end if;
  else
    if p_classification is not null or p_plan is not null or p_venue_limit is not null or p_document_limit_bytes is not null then
      raise exception 'admin_invalid_operation' using errcode='22023';
    end if;
  end if;
  after_state:=private.admin_workspace_snapshot(p_workspace);
  result:=jsonb_build_object('operation_id',p_operation_id,'action',p_action,
    'target_id',p_workspace,'applied_at',applied_at,'period_id',period_id);
  insert into private.admin_operations values(p_operation_id,(select auth.uid()),'workspace',p_workspace,
    p_action,btrim(p_reason),parameters,before_state,after_state,result,applied_at);
  return result;
end;
$$;
-- 4e. Copia integrale di 20261018000000_billing_subscriptions.sql: si comprano
--     le tre fasce, ciascuna con il suo limite.
create or replace function public.billing_prepare_checkout(
  p_environment text, p_user uuid, p_workspace uuid,
  p_plan text, p_interval text, p_extra_venues integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_access jsonb;
  v_plan_price text;
  v_extra_price text;
  v_checkout uuid;
begin
  if p_environment is null or p_environment not in ('sandbox', 'live') then
    raise exception 'billing_invalid_environment' using errcode = '22023';
  end if;
  if p_plan is null or p_plan not in ('base', 'team', 'large')
     or p_interval is null or p_interval not in ('month', 'year')
     or p_extra_venues is null or p_extra_venues not between 0 and 999 then
    raise exception 'billing_invalid_selection' using errcode = '22023';
  end if;
  -- Self-serve fino a 5 sedi in tutto (1 + 4 aggiuntive): oltre serve un
  -- accordo scritto (termini §2). Le concessioni del fondatore non hanno tetto.
  if p_extra_venues > 4 then
    raise exception 'billing_venues_need_agreement' using errcode = '23514';
  end if;
  if p_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  perform private.lock_commercial_workspace(p_workspace);
  -- Acquisto e gestione commerciale sono del titolare, non dei collaboratori.
  if not exists (
    select 1 from public.workspace_members m
      join public.workspaces w on w.id = m.workspace_id and w.deleted_at is null
     where m.workspace_id = p_workspace and m.user_id = p_user
       and m.authority = 'owner' and m.status = 'active') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.billing_subscriptions
              where workspace_id = p_workspace and status <> 'canceled') then
    raise exception 'billing_subscription_exists' using errcode = '23514';
  end if;
  v_access := private.workspace_access_at(p_workspace, now());
  if v_access ->> 'source' = 'complimentary_lifetime' and v_access ->> 'state' = 'operational' then
    raise exception 'billing_not_required' using errcode = '23514';
  end if;
  -- La capacità comprata deve contenere l'organico e le sedi di oggi: nessuno
  -- viene tolto per far posto a un piano più piccolo.
  if (v_access #>> '{usage,people}')::bigint > private.plan_people_limit(p_plan) then
    raise exception 'workspace_people_capacity' using errcode = '23514';
  end if;
  if (v_access #>> '{usage,venues}')::bigint > 1 + p_extra_venues then
    raise exception 'workspace_venue_capacity' using errcode = '23514';
  end if;
  if (select count(*) from public.billing_checkouts
       where workspace_id = p_workspace and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'billing_checkout_rate_limited' using errcode = '53400';
  end if;

  select price_id into v_plan_price from private.billing_prices
   where environment = p_environment and item = p_plan
     and billing_interval = p_interval and selectable;
  if p_extra_venues > 0 then
    select price_id into v_extra_price from private.billing_prices
     where environment = p_environment and item = 'extra_venue'
       and billing_interval = p_interval and selectable;
  end if;
  if v_plan_price is null or (p_extra_venues > 0 and v_extra_price is null) then
    raise exception 'billing_price_unavailable' using errcode = '23514';
  end if;

  insert into public.billing_checkouts (workspace_id, environment, requested_by, plan,
    billing_interval, extra_venues)
  values (p_workspace, p_environment, p_user, p_plan, p_interval, p_extra_venues)
  returning id into v_checkout;

  return jsonb_build_object(
    'checkout_id', v_checkout,
    'items', case when p_extra_venues > 0
      then jsonb_build_array(
        jsonb_build_object('price_id', v_plan_price, 'quantity', 1),
        jsonb_build_object('price_id', v_extra_price, 'quantity', p_extra_venues))
      else jsonb_build_array(jsonb_build_object('price_id', v_plan_price, 'quantity', 1))
    end
  );
end;
$$;
-- 4f. Copie integrali di 20261101000000_billing_scheduled_changes.sql: le tre
--     fasce, «aumento» e «riduzione» dal rango, il limite dalla fascia.
create or replace function private.billing_scheduled_rules_error(p_subscription uuid, p_plan text,
  p_interval text, p_extra integer)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  s public.billing_subscriptions;
  v_usage jsonb;
begin
  if p_plan is null or p_plan not in ('base', 'team', 'large')
     or p_interval is null or p_interval not in ('month', 'year')
     or p_extra is null or p_extra not between 0 and 999 then
    return 'billing_invalid_selection';
  end if;
  select * into s from public.billing_subscriptions where id = p_subscription;
  if not found then
    return 'billing_no_subscription';
  elsif s.status = 'past_due' then
    return 'billing_past_due';
  elsif s.status = 'paused' then
    return 'billing_paused';
  elsif s.status <> 'active' then
    return 'billing_no_subscription';
  elsif s.scheduled_change_action is not null then
    return 'billing_change_scheduled';
  end if;
  -- Gli aumenti passano dalla strada immediata; un cambio misto (più piano e
  -- nuovo ciclo) si fa in due tempi: prima l'aumento, poi il ciclo.
  if private.plan_rank(p_plan) > private.plan_rank(s.plan) or p_extra > s.extra_venues then
    return 'billing_scheduled_not_reduction';
  end if;
  if p_plan = s.plan and p_interval = s.billing_interval and p_extra = s.extra_venues then
    return 'billing_no_change';
  end if;
  -- La capacità futura deve già bastare: si riduce dopo aver chiuso, mai prima.
  -- Il limite della fascia è quello di private.plan_people_limit.
  v_usage := private.workspace_access_at(s.workspace_id, now()) -> 'usage';
  if (v_usage ->> 'people')::integer > private.plan_people_limit(p_plan) then
    return 'billing_scheduled_people';
  end if;
  if (v_usage ->> 'venues')::integer > 1 + p_extra then
    return 'billing_scheduled_venues';
  end if;
  return null;
end;
$$;
create or replace function public.billing_prepare_scheduled_change(
  p_environment text, p_user uuid, p_workspace uuid, p_plan text, p_interval text, p_extra_venues integer
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.billing_subscriptions;
  v_error text;
  v_plan_price text;
  v_extra_price text;
begin
  if p_plan is null or p_plan not in ('base', 'team', 'large')
     or p_interval is null or p_interval not in ('month', 'year')
     or p_extra_venues is null or p_extra_venues not between 0 and 999 then
    raise exception 'billing_invalid_selection' using errcode = '22023';
  end if;
  -- Self-serve fino a 5 sedi in tutto (1 + 4 aggiuntive): oltre serve un
  -- accordo scritto (termini §2). Le concessioni del fondatore non hanno tetto.
  if p_extra_venues > 4 then
    raise exception 'billing_venues_need_agreement' using errcode = '23514';
  end if;
  s := private.billing_owner_subscription(p_environment, p_user, p_workspace);
  if (private.billing_open_scheduled_change(s.id)).id is not null then
    raise exception 'billing_change_pending' using errcode = '23514';
  end if;
  v_error := private.billing_scheduled_rules_error(s.id, p_plan, p_interval, p_extra_venues);
  if v_error is not null then
    raise exception '%', v_error using errcode = '23514';
  end if;
  -- Il cambio deve arrivare prima della finestra d'invio, o non partirebbe.
  if s.current_period_ends_at is null
     or s.current_period_ends_at - now() < private.billing_schedule_window() then
    raise exception 'billing_too_close_to_renewal' using errcode = '23514';
  end if;

  select price_id into v_plan_price from private.billing_prices
   where environment = p_environment and item = p_plan
     and billing_interval = p_interval and selectable;
  select price_id into v_extra_price from private.billing_prices
   where environment = p_environment and item = 'extra_venue'
     and billing_interval = p_interval and selectable;
  if v_plan_price is null or (p_extra_venues > 0 and v_extra_price is null) then
    raise exception 'billing_price_unavailable' using errcode = '23514';
  end if;

  return jsonb_build_object(
    'subscription_id', s.provider_subscription_id,
    'effective_at', s.current_period_ends_at,
    'current_plan', s.plan,
    'current_interval', s.billing_interval,
    'plan', p_plan,
    'billing_interval', p_interval,
    'plan_price_id', v_plan_price,
    'extra_venues', p_extra_venues,
    'extra_price_id', v_extra_price,
    -- Tutti i prezzi conosciuti di quest'ambiente, per riconoscere gli articoli attuali.
    'known_prices', (select jsonb_object_agg(price_id, item) from private.billing_prices
                      where environment = p_environment)
  );
end;
$$;
create or replace function public.billing_record_scheduled_change(
  p_environment text, p_user uuid, p_workspace uuid, p_plan text, p_interval text, p_extra_venues integer,
  p_from_items jsonb, p_target_items jsonb, p_renewal_cents bigint, p_currency text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.billing_subscriptions;
  v_id uuid;
  v_bad integer;
  v_plan_items integer;
  v_plan_ok integer;
  v_extra numeric;
begin
  perform private.lock_commercial_workspace(p_workspace);
  perform public.billing_prepare_scheduled_change(p_environment, p_user, p_workspace,
    p_plan, p_interval, p_extra_venues);
  s := private.billing_owner_subscription(p_environment, p_user, p_workspace);

  -- Forma: array di `{price_id, quantity}` con quantità intera positiva.
  if jsonb_typeof(p_from_items) is distinct from 'array'
     or jsonb_typeof(p_target_items) is distinct from 'array' then
    raise exception 'billing_invalid_selection' using errcode = '22023';
  end if;
  if exists (
    select 1 from (select * from jsonb_array_elements(p_from_items)
                   union all select * from jsonb_array_elements(p_target_items)) e (i)
     where jsonb_typeof(i) is distinct from 'object'
        or jsonb_typeof(i -> 'price_id') is distinct from 'string'
        or jsonb_typeof(i -> 'quantity') is distinct from 'number') then
    raise exception 'billing_invalid_selection' using errcode = '22023';
  end if;
  if exists (
    select 1 from (select * from jsonb_array_elements(p_from_items)
                   union all select * from jsonb_array_elements(p_target_items)) e (i)
     where i ->> 'price_id' !~ '^pri_[a-z0-9]+$'
        or (i ->> 'quantity')::numeric < 1
        or (i ->> 'quantity')::numeric <> trunc((i ->> 'quantity')::numeric)) then
    raise exception 'billing_invalid_selection' using errcode = '22023';
  end if;

  -- Contenuto: prezzi noti del ciclo d'arrivo, un solo piano (quello scelto),
  -- tante sedi quante richieste. Un prezzo non più proposto è ammesso solo se
  -- l'articolo c'era già: chi non cambia tiene il suo listino.
  select count(*) filter (where bp.price_id is null or bp.billing_interval <> p_interval
                            or (not bp.selectable and not exists (
                              select 1 from jsonb_array_elements(p_from_items) f
                               where f ->> 'price_id' = i ->> 'price_id'))),
         count(*) filter (where bp.item in ('base', 'team', 'large')),
         count(*) filter (where bp.item = p_plan and (i ->> 'quantity')::numeric = 1),
         coalesce(sum((i ->> 'quantity')::numeric) filter (where bp.item = 'extra_venue'), 0)
    into v_bad, v_plan_items, v_plan_ok, v_extra
    from jsonb_array_elements(p_target_items) i
    left join private.billing_prices bp
      on bp.environment = p_environment and bp.price_id = i ->> 'price_id';
  if v_bad > 0 or v_plan_items <> 1 or v_plan_ok <> 1 or v_extra <> p_extra_venues then
    raise exception 'billing_invalid_selection' using errcode = '22023';
  end if;

  insert into public.billing_scheduled_changes (subscription_id, workspace_id, environment,
    target_plan, target_interval, target_extra_venues, from_interval, from_items, target_items,
    renewal_cents, currency, effective_at, requested_by)
  values (s.id, s.workspace_id, p_environment, p_plan, p_interval, p_extra_venues, s.billing_interval,
    p_from_items, p_target_items, p_renewal_cents, p_currency, s.current_period_ends_at, p_user)
  returning id into v_id;
  return v_id;
end;
$$;
create or replace function public.billing_prepare_change(
  p_environment text, p_user uuid, p_workspace uuid, p_plan text, p_extra_venues integer
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.billing_subscriptions;
  v_plan_price text;
  v_extra_price text;
begin
  if p_plan is null or p_plan not in ('base', 'team', 'large')
     or p_extra_venues is null or p_extra_venues not between 0 and 999 then
    raise exception 'billing_invalid_selection' using errcode = '22023';
  end if;
  -- Self-serve fino a 5 sedi in tutto (1 + 4 aggiuntive): oltre serve un
  -- accordo scritto (termini §2). Le concessioni del fondatore non hanno tetto.
  if p_extra_venues > 4 then
    raise exception 'billing_venues_need_agreement' using errcode = '23514';
  end if;
  s := private.billing_owner_subscription(p_environment, p_user, p_workspace);
  if (private.billing_open_scheduled_change(s.id)).id is not null then
    raise exception 'billing_change_pending' using errcode = '23514';
  end if;
  if s.status = 'past_due' then
    raise exception 'billing_past_due' using errcode = '23514';
  elsif s.status = 'paused' then
    raise exception 'billing_paused' using errcode = '23514';
  end if;
  if s.scheduled_change_action is not null then
    raise exception 'billing_change_scheduled' using errcode = '23514';
  end if;
  if private.plan_rank(p_plan) < private.plan_rank(s.plan) or p_extra_venues < s.extra_venues then
    raise exception 'billing_downgrade_unsupported' using errcode = '23514';
  end if;
  if p_plan = s.plan and p_extra_venues = s.extra_venues then
    raise exception 'billing_no_change' using errcode = '23514';
  end if;

  select price_id into v_plan_price from private.billing_prices
   where environment = p_environment and item = p_plan
     and billing_interval = s.billing_interval and selectable;
  select price_id into v_extra_price from private.billing_prices
   where environment = p_environment and item = 'extra_venue'
     and billing_interval = s.billing_interval and selectable;
  if v_plan_price is null or (p_extra_venues > 0 and v_extra_price is null) then
    raise exception 'billing_price_unavailable' using errcode = '23514';
  end if;

  return jsonb_build_object(
    'subscription_id', s.provider_subscription_id,
    'current_plan', s.plan,
    'plan', p_plan,
    'plan_price_id', v_plan_price,
    'extra_venues', p_extra_venues,
    'extra_price_id', v_extra_price,
    -- Tutti i prezzi conosciuti di quest'ambiente, per riconoscere gli articoli attuali.
    'known_prices', (select jsonb_object_agg(price_id, item) from private.billing_prices
                      where environment = p_environment)
  );
end;
$$;
-- 4g. Copia integrale di 20261101000200_billing_scheduled_capacity.sql: la
--     capacità futura è il limite della fascia d'arrivo.
create or replace function private.billing_future_limits(p_workspace uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'people', private.plan_people_limit(c.target_plan),
    'venues', 1 + c.target_extra_venues)
  from public.billing_subscriptions s
  cross join lateral private.billing_open_scheduled_change(s.id) c
  where s.workspace_id = p_workspace and s.status <> 'canceled' and c.id is not null
  limit 1
$$;
-- 4h. Copia integrale di 20261019000800_paused_items.sql: l'avviso riconosce le
--     tre fasce. `max(bp.item)` resta corretto: c'è al più una voce di fascia.
create or replace function public.billing_apply_event(p_environment text, p_event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_event_id text := p_event ->> 'event_id';
  v_type text := p_event ->> 'event_type';
  v_occurred timestamptz;
  d jsonb := p_event -> 'data';
  v_error text;
  v_status text;
  v_interval text;
  v_plan text;
  v_plan_items integer;
  v_plan_quantity integer;
  v_extra integer;
  v_unknown integer;
  v_intervals integer;
  v_checkout_ref text;
  v_checkout public.billing_checkouts;
  v_workspace uuid;
  s public.billing_subscriptions;
  v_existing boolean;
begin
  if p_environment is null or p_environment not in ('sandbox', 'live') then
    raise exception 'billing_invalid_environment' using errcode = '22023';
  end if;
  if v_event_id is null or v_event_id !~ '^evt_[a-z0-9]+$' or v_type is null
     or p_event ->> 'occurred_at' is null then
    raise exception 'billing_invalid_event' using errcode = '22023';
  end if;
  v_occurred := (p_event ->> 'occurred_at')::timestamptz;

  -- Due consegne simultanee dello stesso evento: la seconda attende la prima e
  -- la trova nel registro, invece di applicarlo due volte.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_environment || ':' || v_event_id, 202610180000));
  -- Stesso evento già ricevuto: nessun effetto, qualunque fosse l'esito.
  perform 1 from private.billing_events
   where environment = p_environment and event_id = v_event_id;
  if found then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  if v_type in ('adjustment.created', 'adjustment.updated') then
    return private.billing_apply_adjustment(p_environment, v_event_id, v_type, v_occurred, p_event);
  end if;
  if v_type not like 'subscription.%' then
    -- Le transazioni restano nel registro: i rimborsi le rileggono da qui.
    insert into private.billing_events (environment, event_id, event_type, occurred_at, payload, outcome)
    values (p_environment, v_event_id, v_type, v_occurred, p_event, 'ignored');
    return jsonb_build_object('outcome', 'ignored');
  end if;

  -- Forma dell'abbonamento. Un dato che non torna non concede nulla.
  v_status := d ->> 'status';
  v_interval := d #>> '{billing_cycle,interval}';
  if d ->> 'id' is null or d ->> 'id' !~ '^sub_[a-z0-9]+$'
     or d ->> 'customer_id' is null or d ->> 'customer_id' !~ '^ctm_[a-z0-9]+$' then
    v_error := 'invalid_subscription';
  elsif v_status is null or v_status not in ('active', 'past_due', 'paused', 'canceled') then
    -- `trialing` compreso: le prove le gestisce KlokShift, non Paddle.
    v_error := 'unsupported_status';
  elsif v_interval is null or v_interval not in ('month', 'year')
     or coalesce(d #>> '{billing_cycle,frequency}', '') <> '1' then
    v_error := 'unsupported_billing_cycle';
  elsif v_status in ('active', 'past_due') and (
     d #>> '{current_billing_period,starts_at}' is null
     or d #>> '{current_billing_period,ends_at}' is null
     or (d #>> '{current_billing_period,ends_at}')::timestamptz
        <= (d #>> '{current_billing_period,starts_at}')::timestamptz) then
    v_error := 'invalid_billing_period';
  elsif jsonb_typeof(d -> 'items') is distinct from 'array' then
    v_error := 'invalid_items';
  end if;

  if v_error is null then
    select count(*) filter (where bp.price_id is null),
           count(*) filter (where bp.item in ('base', 'team', 'large')),
           max(bp.item) filter (where bp.item in ('base', 'team', 'large')),
           max((i ->> 'quantity')::integer) filter (where bp.item in ('base', 'team', 'large')),
           coalesce(sum((i ->> 'quantity')::integer) filter (where bp.item = 'extra_venue'), 0),
           count(distinct bp.billing_interval)
             filter (where bp.billing_interval is distinct from v_interval)
      into v_unknown, v_plan_items, v_plan, v_plan_quantity, v_extra, v_intervals
      from jsonb_array_elements(d -> 'items') i
      left join private.billing_prices bp
        on bp.environment = p_environment and bp.price_id = i #>> '{price,id}'
     -- In pausa o disdetto Paddle segna le voci `inactive`: descrivono comunque
     -- il piano che l'abbonamento aveva, e senza di loro l'avviso si scartava.
     where (coalesce(i ->> 'status', 'active') <> 'inactive' or v_status in ('paused', 'canceled'))
       and coalesce(i ->> 'recurring', 'true') = 'true';
    if v_unknown > 0 then
      v_error := 'unknown_price';
    elsif v_plan_items <> 1 or v_plan_quantity <> 1 then
      v_error := 'invalid_plan_items';
    elsif v_intervals > 0 then
      v_error := 'mixed_billing_interval';
    elsif v_extra > 999 then
      v_error := 'invalid_items';
    end if;
  end if;

  if v_error is null then
    select * into s from public.billing_subscriptions
     where environment = p_environment and provider_subscription_id = d ->> 'id';
    v_existing := found;
    if v_existing then
      v_workspace := s.workspace_id;
    else
      -- Il primo evento collega l'abbonamento alla richiesta preparata dal server.
      v_checkout_ref := d #>> '{custom_data,klokshift_checkout}';
      if v_checkout_ref is null
         or v_checkout_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_error := 'unlinked_subscription';
      else
        select * into v_checkout from public.billing_checkouts
         where id = v_checkout_ref::uuid and environment = p_environment;
        if not found or v_checkout.status <> 'open' then
          v_error := 'unlinked_subscription';
        else
          v_workspace := v_checkout.workspace_id;
        end if;
      end if;
    end if;
  end if;

  if v_error is not null then
    insert into private.billing_events (environment, event_id, event_type, occurred_at,
      payload, outcome, error, subscription_id)
    values (p_environment, v_event_id, v_type, v_occurred, p_event, 'rejected', v_error,
      case when v_existing then s.id end);
    return jsonb_build_object('outcome', 'rejected', 'error', v_error);
  end if;

  -- Stesso lock di capacità, prova e concessioni.
  perform private.lock_commercial_workspace(v_workspace);

  -- Paddle manda insieme `subscription.created` e `subscription.activated` dello
  -- stesso abbonamento: il gemello può averlo creato mentre si aspettava il lock.
  -- Senza questa rilettura il secondo risultava un «secondo abbonamento».
  if not v_existing then
    select * into s from public.billing_subscriptions
     where environment = p_environment and provider_subscription_id = d ->> 'id';
    v_existing := found;
  end if;

  if v_existing then
    select * into s from public.billing_subscriptions where id = s.id for update;
    -- Paddle non garantisce l'ordine: ogni evento porta lo stato completo,
    -- quindi uno più vecchio dell'ultimo applicato non aggiunge nulla.
    if v_occurred < s.last_event_at then
      insert into private.billing_events (environment, event_id, event_type, occurred_at,
        payload, outcome, subscription_id)
      values (p_environment, v_event_id, v_type, v_occurred, p_event, 'stale', s.id);
      return jsonb_build_object('outcome', 'stale', 'subscription_id', s.id);
    end if;
    update public.billing_subscriptions set
      provider_customer_id = d ->> 'customer_id',
      status = v_status,
      plan = v_plan,
      billing_interval = v_interval,
      extra_venues = v_extra,
      current_period_starts_at = (d #>> '{current_billing_period,starts_at}')::timestamptz,
      current_period_ends_at = (d #>> '{current_billing_period,ends_at}')::timestamptz,
      scheduled_change_action = d #>> '{scheduled_change,action}',
      scheduled_change_at = (d #>> '{scheduled_change,effective_at}')::timestamptz,
      past_due_since = case when v_status = 'past_due'
        then coalesce(past_due_since, v_occurred) end,
      canceled_at = (d ->> 'canceled_at')::timestamptz,
      paused_at = (d ->> 'paused_at')::timestamptz,
      last_event_id = v_event_id,
      last_event_at = v_occurred
     where id = s.id
    returning * into s;
  else
    if exists (select 1 from public.billing_subscriptions
                where workspace_id = v_workspace and status <> 'canceled')
       and v_status <> 'canceled' then
      -- Secondo abbonamento aperto: va rimborsato, non sommato.
      insert into private.billing_events (environment, event_id, event_type, occurred_at,
        payload, outcome, error)
      values (p_environment, v_event_id, v_type, v_occurred, p_event, 'rejected',
        'duplicate_subscription');
      return jsonb_build_object('outcome', 'rejected', 'error', 'duplicate_subscription');
    end if;
    insert into public.billing_subscriptions (workspace_id, environment,
      provider_subscription_id, provider_customer_id, status, plan, billing_interval,
      extra_venues, current_period_starts_at, current_period_ends_at,
      scheduled_change_action, scheduled_change_at, past_due_since, canceled_at, paused_at,
      last_event_id, last_event_at)
    values (v_workspace, p_environment, d ->> 'id', d ->> 'customer_id', v_status, v_plan,
      v_interval, v_extra,
      (d #>> '{current_billing_period,starts_at}')::timestamptz,
      (d #>> '{current_billing_period,ends_at}')::timestamptz,
      d #>> '{scheduled_change,action}',
      (d #>> '{scheduled_change,effective_at}')::timestamptz,
      case when v_status = 'past_due' then v_occurred end,
      (d ->> 'canceled_at')::timestamptz, (d ->> 'paused_at')::timestamptz,
      v_event_id, v_occurred)
    returning * into s;
    update public.billing_checkouts
       set status = 'completed', completed_at = v_occurred, subscription_id = s.id
     where id = v_checkout.id;
    -- Un acquisto verificato è una classificazione commerciale esplicita.
    update public.workspace_commercial_state set migration_review_required = false
     where workspace_id = v_workspace;
  end if;

  perform private.billing_sync_periods(s.id, v_occurred);
  insert into private.billing_events (environment, event_id, event_type, occurred_at,
    payload, outcome, subscription_id)
  values (p_environment, v_event_id, v_type, v_occurred, p_event, 'applied', s.id);
  return jsonb_build_object('outcome', 'applied', 'subscription_id', s.id,
    'workspace_id', v_workspace);
end;
$$;
-- 4i. Copia integrale di 20261012000800_trial_new_workspaces_only.sql: la prova
--     è Grande.
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
    p_workspace, 'trial', 'large', 1, v_now, v_now + interval '720 hours',
    'Prova iniziale di 30 giorni senza carta'
  ) returning id into v_period;
  update public.workspace_commercial_state
     set trial_started_at = v_now where workspace_id = p_workspace;
  return v_period;
end;
$function$
;

-- 4j. Copia integrale di 20261005000100_workspace_access.sql: le concessioni di
--     servizio accettano tutte le fasce, compreso il perimetro personalizzato.
create or replace function public.grant_workspace_access(
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
  if p_plan is null or p_plan not in ('base', 'team', 'large', 'custom') then
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

