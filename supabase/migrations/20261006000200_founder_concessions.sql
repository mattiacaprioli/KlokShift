-- M06a: assegnazione esplicita dal fondatore, classificazione e registro.
-- Nessuna azienda esistente viene convertita all'applicazione della migration.
-- La quota documenti viene dichiarata; il blocco upload per quota è un follow-up.
alter table public.workspace_access_periods add column document_limit_bytes bigint
  check (document_limit_bytes > 0 and document_limit_bytes <= 9007199254740991);

-- Senza FK sui destinatari/attore: il registro deve sopravvivere alla loro
-- eliminazione. Nessun contenuto HR, segreto o payload SQL arbitrario.
create table private.admin_operations (
  operation_id uuid primary key,
  actor_id uuid not null,
  target_kind text not null check (target_kind in ('workspace','account')),
  target_id uuid not null,
  action text not null check (action in ('grant_lifetime','set_classification','add_note')),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  parameters jsonb not null,
  before_state jsonb not null,
  after_state jsonb not null,
  result jsonb not null,
  applied_at timestamptz not null
);
alter table private.admin_operations enable row level security;
create index admin_operations_target_idx on private.admin_operations(target_kind,target_id,applied_at desc,operation_id);
revoke all on private.admin_operations from public,anon,authenticated,service_role;
grant select on private.admin_operations to service_role;

create function private.admin_workspace_snapshot(p_workspace uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'classification',coalesce(l.classification,'unclassified'),
    'migration_review_required',c.migration_review_required,
    'access',case when c.workspace_id is not null and w.deleted_at is null
      then private.workspace_access_at(w.id,now()) else null end,
    'document_known_bytes',coalesce(s.known_bytes,0),
    'document_unknown_sizes',coalesce(s.unknown_sizes,0),
    'lifetime',(select jsonb_build_object('period_id',p.id,'plan',p.plan,
      'venue_limit',p.venue_limit,'document_limit_bytes',p.document_limit_bytes)
      from public.workspace_access_periods p where p.workspace_id=w.id
        and c.workspace_id is not null and w.deleted_at is null
        and p.kind='complimentary_lifetime' and p.starts_at<=now()
        and (p.revoked_at is null or p.revoked_at>now())
      order by p.starts_at desc,p.created_at desc,p.id desc limit 1))
  from public.workspaces w left join public.workspace_commercial_state c on c.workspace_id=w.id
  left join private.admin_workspace_labels l on l.workspace_id=w.id
  left join private.admin_workspace_storage s on s.workspace_id=w.id where w.id=p_workspace;
$$;

-- Include uso corrente e periodi futuri, così una conferma vecchia non
-- sovrascrive interventi concorrenti. Esclude l'orologio di lettura:
-- due richieste senza cambi devono produrre la stessa revisione.
-- L'hash non costituisce autorizzazione.
create function private.admin_workspace_revision(p_workspace uuid)
returns text language sql stable security definer set search_path='' as $$
  select md5(jsonb_build_object('snapshot',private.admin_workspace_snapshot(w.id) #- '{access,server_now}',
    'deleted_at',w.deleted_at,'commercial',to_jsonb(c),'label',to_jsonb(l),
    'periods',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb)
      from public.workspace_access_periods p where p.workspace_id=w.id))::text)
  from public.workspaces w left join public.workspace_commercial_state c on c.workspace_id=w.id
  left join private.admin_workspace_labels l on l.workspace_id=w.id where w.id=p_workspace;
$$;

create function private.admin_account_revision(p_account uuid)
returns text language sql stable security definer set search_path='' as $$
  select md5(jsonb_build_object('id',u.id,'deleted_at',u.deleted_at,'label',to_jsonb(l))::text)
  from auth.users u left join private.admin_account_labels l on l.user_id=u.id where u.id=p_account;
$$;

create function private.admin_operation_replay(p_operation uuid,p_kind text,p_target uuid,p_action text,p_parameters jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare op private.admin_operations;
begin
  if p_operation is null then raise exception 'admin_invalid_operation' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operation::text,202610060002));
  select * into op from private.admin_operations where operation_id=p_operation;
  if found then
    if op.actor_id is distinct from (select auth.uid()) or op.target_kind<>p_kind
      or op.target_id is distinct from p_target or op.action<>p_action
      or op.parameters is distinct from p_parameters then
      raise exception 'admin_operation_conflict' using errcode='23514';
    end if;
    return op.result;
  end if;
  return null;
end;
$$;

create function public.admin_get_workspace_control(p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare snapshot jsonb; revision text;
begin
  perform private.require_platform_admin();
  select private.admin_workspace_snapshot(w.id),private.admin_workspace_revision(w.id)
    into snapshot,revision from public.workspaces w where w.id=p_workspace and w.deleted_at is null;
  if not found then raise exception 'admin_not_found' using errcode='P0002'; end if;
  return jsonb_build_object('generated_at',now(),'target_id',p_workspace,'revision',revision,'snapshot',snapshot);
end;
$$;

create function public.admin_get_account_control(p_account uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare revision text; classification text;
begin
  perform private.require_platform_admin();
  select private.admin_account_revision(u.id),coalesce(l.classification,'unclassified')
    into revision,classification from auth.users u
    left join private.admin_account_labels l on l.user_id=u.id where u.id=p_account;
  if not found then raise exception 'admin_not_found' using errcode='P0002'; end if;
  return jsonb_build_object('generated_at',now(),'target_id',p_account,'revision',revision,'classification',classification);
end;
$$;

create function public.admin_apply_workspace_action(
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
    if p_plan is null or p_plan not in ('base','team') then
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
    if p_plan='base' and (access#>>'{usage,people}')::bigint>30 then
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

create function public.admin_set_account_classification(
  p_account uuid,p_classification text,p_reason text,p_operation_id uuid,p_expected_revision text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare parameters jsonb; replay jsonb; before_classification text; result jsonb; applied_at timestamptz;
begin
  perform private.require_platform_admin();
  if p_classification is null or p_classification not in ('customer','internal','test','unclassified') then
    raise exception 'admin_invalid_operation' using errcode='22023';
  end if;
  if length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then
    raise exception 'admin_reason_required' using errcode='23514';
  end if;
  if p_expected_revision is null or p_expected_revision !~ '^[0-9a-f]{32}$' then
    raise exception 'admin_revision_required' using errcode='22023';
  end if;
  parameters:=jsonb_build_object('classification',p_classification,'reason',btrim(p_reason),'revision',p_expected_revision);
  replay:=private.admin_operation_replay(p_operation_id,'account',p_account,'set_classification',parameters);
  perform private.require_platform_admin();
  if replay is not null then return replay; end if;
  perform 1 from auth.users where id=p_account for update;
  if not found then raise exception 'admin_not_found' using errcode='P0002'; end if;
  perform private.require_platform_admin();
  if private.admin_account_revision(p_account) is distinct from p_expected_revision then
    raise exception 'admin_stale_revision' using errcode='40001';
  end if;
  select coalesce((select classification from private.admin_account_labels where user_id=p_account),'unclassified') into before_classification;
  applied_at:=now();
  if p_classification='unclassified' then
    delete from private.admin_account_labels where user_id=p_account;
  else
    insert into private.admin_account_labels(user_id,classification,reason,updated_at)
    values(p_account,p_classification,btrim(p_reason),applied_at)
    on conflict(user_id) do update set classification=excluded.classification,reason=excluded.reason,updated_at=excluded.updated_at;
  end if;
  result:=jsonb_build_object('operation_id',p_operation_id,'action','set_classification',
    'target_id',p_account,'applied_at',applied_at,'period_id',null);
  insert into private.admin_operations values(p_operation_id,(select auth.uid()),'account',p_account,
    'set_classification',btrim(p_reason),parameters,jsonb_build_object('classification',before_classification),
    jsonb_build_object('classification',p_classification),result,applied_at);
  return result;
end;
$$;

create function public.admin_list_operations(p_target_kind text,p_target uuid,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_platform_admin();
  perform private.validate_admin_page('',25,p_offset);
  if p_target_kind is null or p_target_kind not in ('workspace','account') or p_target is null then
    raise exception 'admin_invalid_filter' using errcode='22023';
  end if;
  select jsonb_build_object('generated_at',now(),'target_kind',p_target_kind,'target_id',p_target,
    'total',(select count(*) from private.admin_operations where target_kind=p_target_kind and target_id=p_target),
    'limit',25,'offset',p_offset,'items',coalesce(jsonb_agg(to_jsonb(op)),'[]'::jsonb)) into result
  from (select operation_id,actor_id,action,reason,before_state,after_state,applied_at
    from private.admin_operations where target_kind=p_target_kind and target_id=p_target
    order by applied_at desc,operation_id limit 25 offset p_offset) op;
  return result;
end;
$$;

revoke all on function private.admin_workspace_snapshot(uuid),private.admin_workspace_revision(uuid),
  private.admin_account_revision(uuid),private.admin_operation_replay(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.admin_get_workspace_control(uuid),public.admin_get_account_control(uuid),
  public.admin_apply_workspace_action(uuid,text,text,uuid,text,text,integer,bigint,text),
  public.admin_set_account_classification(uuid,text,text,uuid,text),
  public.admin_list_operations(text,uuid,integer) from public,anon,authenticated;
grant execute on function public.admin_get_workspace_control(uuid),public.admin_get_account_control(uuid),
  public.admin_apply_workspace_action(uuid,text,text,uuid,text,text,integer,bigint,text),
  public.admin_set_account_classification(uuid,text,text,uuid,text),
  public.admin_list_operations(text,uuid,integer) to authenticated;
