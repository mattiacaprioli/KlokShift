-- M05: sola consultazione amministrativa. Nessun cliente diventa admin perché
-- è owner. Nessuna allowlist implicita per email, metadata o primo registrato.
create table private.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  reason text not null check (btrim(reason) <> ''),
  revoked_at timestamptz
);
create table private.admin_workspace_labels (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  classification text not null check (classification in ('customer','internal','test')),
  reason text not null check (btrim(reason) <> ''),
  updated_at timestamptz not null default now()
);
create table private.admin_account_labels (
  user_id uuid primary key references auth.users(id) on delete cascade,
  classification text not null check (classification in ('customer','internal','test')),
  reason text not null check (btrim(reason) <> ''),
  updated_at timestamptz not null default now()
);
alter table private.platform_admins enable row level security;
alter table private.admin_workspace_labels enable row level security;
alter table private.admin_account_labels enable row level security;
revoke all on private.platform_admins,private.admin_workspace_labels,private.admin_account_labels
  from public,anon,authenticated;
grant select,insert,update,delete on private.platform_admins,private.admin_workspace_labels,private.admin_account_labels to service_role;

-- Revoca allowlist, account bloccato/eliminato, logout e termine sessione
-- sono riletti a ogni RPC, anche se il JWT non è ancora scaduto.
create function private.platform_admin_eligible()
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from private.platform_admins a join auth.users u on u.id=a.user_id
    join auth.sessions s on s.user_id=u.id and s.id::text=(select auth.jwt()->>'session_id')
    where a.user_id=(select auth.uid()) and a.revoked_at is null
      and u.deleted_at is null and not u.is_anonymous and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=now())
      and (s.not_after is null or s.not_after>now())
  );
$$;
create function private.platform_admin_mfa_verified()
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.jwt()->>'aal')='aal2' and exists (
    select 1 from auth.mfa_factors f where f.user_id=(select auth.uid()) and f.status='verified'
  );
$$;
create function private.require_platform_admin()
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode='28000'; end if;
  if not private.platform_admin_eligible() then raise exception 'admin_not_allowed' using errcode='42501'; end if;
  if not coalesce(private.platform_admin_mfa_verified(),false) then
    raise exception 'admin_mfa_required' using errcode='42501';
  end if;
end;
$$;
-- Solo lo stato del chiamante: permette setup/challenge MFA prima di aal2.
create function public.get_platform_admin_access()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare eligible boolean;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode='28000'; end if;
  eligible:=private.platform_admin_eligible();
  return jsonb_build_object('eligible',eligible,
    'can_access',eligible and coalesce(private.platform_admin_mfa_verified(),false));
end;
$$;

-- Fonte spazio: oggetti Storage, non size_bytes dichiarato dal client. Nessun
-- nome file/percorso/documento HR viene esposto dall'area amministrativa.
create view private.admin_workspace_storage as
select m.workspace_id,count(*)::bigint as files,
  coalesce(sum(case when o.metadata->>'size' ~ '^(0|[1-9][0-9]{0,17})$'
    then (o.metadata->>'size')::numeric else 0 end),0) as known_bytes,
  count(*) filter (where o.metadata->>'size' is null
    or o.metadata->>'size' !~ '^(0|[1-9][0-9]{0,17})$')::bigint as unknown_sizes
from storage.objects o join public.workspace_members m on m.id::text=split_part(o.name,'/',1)
where o.bucket_id='staff-documents' group by m.workspace_id;

create view private.admin_workspace_rows as
select w.id,w.name,w.created_at,w.deleted_at,
  coalesce(l.classification,'unclassified') as classification,
  case when w.deleted_at is not null then 'deleted'
    when c.workspace_id is null then 'unavailable' else a.access->>'state' end as state,
  a.access,
  (select count(*) from public.venues v where v.workspace_id=w.id and v.closed_at is null) as open_venues,
  (select count(*) from public.venues v where v.workspace_id=w.id and v.closed_at is not null) as closed_venues,
  (select count(*) from public.workspace_members m where m.workspace_id=w.id and m.status='active') as active_members,
  (select count(*) from public.workspace_members m where m.workspace_id=w.id and m.status='invited') as invited_members,
  (select count(*) from public.workspace_members m where m.workspace_id=w.id and m.status='left') as left_members,
  (select count(*) from public.workspace_members m where m.workspace_id=w.id and m.status<>'left' and m.user_id is null) as unlinked_members,
  (select count(*) from public.workspace_members m where m.workspace_id=w.id and m.status='active' and m.authority in ('owner','collaborator')) as managers,
  (select count(*) from public.venue_members vm where vm.workspace_id=w.id and vm.left_at is null) as current_placements,
  coalesce(d.files,0) as document_files,coalesce(d.known_bytes,0) as document_known_bytes,
  coalesce(d.unknown_sizes,0) as document_unknown_sizes
from public.workspaces w
left join private.admin_workspace_labels l on l.workspace_id=w.id
left join public.workspace_commercial_state c on c.workspace_id=w.id
left join lateral (select case when w.deleted_at is null and c.workspace_id is not null
  then private.workspace_access_at(w.id,now()) else null end as access) a on true
left join private.admin_workspace_storage d on d.workspace_id=w.id;

create view private.admin_account_rows as
select u.id,p.full_name,u.email,u.created_at,u.email_confirmed_at,u.last_sign_in_at,u.deleted_at,u.is_anonymous,
  case when u.deleted_at is not null then 'deleted' when u.is_anonymous then 'anonymous'
    when u.email_confirmed_at is null then 'unconfirmed' else 'confirmed' end as status,
  coalesce(l.classification,'unclassified') as classification,
  (select count(*) from public.workspace_members m where m.user_id=u.id and m.status='active') as active_memberships,
  (select count(*) from public.workspace_members m where m.user_id=u.id and m.status='invited') as invited_memberships,
  (select count(*) from public.workspace_members m where m.user_id=u.id and m.status='left') as left_memberships
from auth.users u left join public.profiles p on p.id=u.id
left join private.admin_account_labels l on l.user_id=u.id;
revoke all on private.admin_workspace_storage,private.admin_workspace_rows,private.admin_account_rows from public,anon,authenticated;

create function private.admin_workspace_flags(p_row private.admin_workspace_rows)
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
      p_row.access#>>'{limits,people}'='30' and (p_row.access#>>'{usage,people}')::bigint>=28),
    ('people_over_capacity','critical',null::timestamptz,'Conteggio commerciale aziendale',
      (p_row.access#>>'{usage,people}')::bigint>(p_row.access#>>'{limits,people}')::bigint),
    ('venues_over_capacity','critical',null::timestamptz,'Sedi aperte aziendali',
      p_row.open_venues>(p_row.access#>>'{limits,venues}')::bigint),
    ('document_measurement_incomplete','warning',null::timestamptz,'Storage: metadata.size',p_row.document_unknown_sizes>0)
  ) f(code,severity,at,source,show) where show;
$$;
create function private.admin_workspace_json(p_row private.admin_workspace_rows)
returns jsonb language sql stable security definer set search_path='' as $$
  select to_jsonb(p_row)||jsonb_build_object('flags',private.admin_workspace_flags(p_row));
$$;
create function private.validate_admin_page(p_query text,p_limit integer,p_offset integer)
returns void language plpgsql immutable set search_path='' as $$
begin
  if p_limit is null or p_limit<1 or p_limit>50 or p_offset is null or p_offset<0 or p_offset>100000
    or length(coalesce(p_query,''))>120 then raise exception 'admin_invalid_filter' using errcode='22023'; end if;
end;
$$;

create function public.admin_get_overview()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_platform_admin();
  with rows as materialized (select * from private.admin_workspace_rows),
  signals as (select r.id,r.name,f.value as flag from rows r
    cross join lateral jsonb_array_elements(private.admin_workspace_flags(r)) f
    order by case f.value->>'severity' when 'critical' then 0 when 'warning' then 1 else 2 end,
      (f.value->>'at')::timestamptz nulls last,r.id limit 20)
  select jsonb_build_object(
    'generated_at',now(),
    'workspaces',jsonb_build_object('total',(select count(*) from rows),
      'states',(select coalesce(jsonb_object_agg(state,n),'{}'::jsonb) from (select state,count(*) n from rows group by state) s),
      'classifications',(select coalesce(jsonb_object_agg(classification,n),'{}'::jsonb) from (select classification,count(*) n from rows group by classification) s),
      'operational_sources',(select coalesce(jsonb_object_agg(source,n),'{}'::jsonb) from (select access->>'source' source,count(*) n from rows where state='operational' group by access->>'source') s)),
    'accounts',jsonb_build_object('total',(select count(*) from auth.users where deleted_at is null),
      'confirmed',(select count(*) from auth.users where deleted_at is null and email_confirmed_at is not null),
      'unconfirmed',(select count(*) from auth.users where deleted_at is null and email_confirmed_at is null),
      'anonymous',(select count(*) from auth.users where deleted_at is null and is_anonymous),
      'deleted_available',(select count(*) from auth.users where deleted_at is not null)),
    'usage',jsonb_build_object('open_venues',(select coalesce(sum(open_venues),0) from rows),
      'closed_venues',(select coalesce(sum(closed_venues),0) from rows),
      'active_members',(select coalesce(sum(active_members),0) from rows),
      'invited_members',(select coalesce(sum(invited_members),0) from rows),
      'left_members',(select coalesce(sum(left_members),0) from rows),
      'unlinked_members',(select coalesce(sum(unlinked_members),0) from rows),
      'managers',(select coalesce(sum(managers),0) from rows),
      'current_placements',(select coalesce(sum(current_placements),0) from rows),
      'commercial_people',(select coalesce(sum((access#>>'{usage,people}')::bigint),0) from rows)),
    'documents',jsonb_build_object('files',(select count(*) from storage.objects where bucket_id='staff-documents'),
      'known_bytes',(select coalesce(sum(case when metadata->>'size' ~ '^(0|[1-9][0-9]{0,17})$' then (metadata->>'size')::numeric else 0 end),0) from storage.objects where bucket_id='staff-documents'),
      'unknown_sizes',(select count(*) from storage.objects where bucket_id='staff-documents' and (metadata->>'size' is null or metadata->>'size' !~ '^(0|[1-9][0-9]{0,17})$')),
      'unattributed_files',(select count(*) from storage.objects o where bucket_id='staff-documents' and not exists(select 1 from public.workspace_members m where m.id::text=split_part(o.name,'/',1)))),
    'signals',(select coalesce(jsonb_agg(jsonb_build_object('workspace_id',id,'workspace_name',name)||flag),'[]'::jsonb) from signals),
    'finance',null,'costs',null
  ) into result;
  return result;
end;
$$;

create function public.admin_list_workspaces(p_query text default '',p_state text default 'all',p_plan text default 'all',
  p_classification text default 'all',p_limit integer default 25,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_platform_admin();
  perform private.validate_admin_page(p_query,p_limit,p_offset);
  if p_state is null or p_state<>all(array['all','setup','operational','archive','expired','migration_pending','unavailable','deleted'])
    or p_plan is null or p_plan<>all(array['all','base','team'])
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

create function public.admin_get_workspace(p_workspace uuid,p_members_offset integer default 0,
  p_venues_offset integer default 0,p_periods_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w private.admin_workspace_rows; members jsonb; venues jsonb; periods jsonb;
begin
  perform private.require_platform_admin();
  perform private.validate_admin_page('',25,p_members_offset);
  perform private.validate_admin_page('',25,p_venues_offset);
  perform private.validate_admin_page('',25,p_periods_offset);
  select * into w from private.admin_workspace_rows where id=p_workspace;
  if not found then raise exception 'admin_not_found' using errcode='P0002'; end if;
  select jsonb_build_object('total',(select count(*) from public.workspace_members where workspace_id=p_workspace),'limit',25,'offset',p_members_offset,
    'items',coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb)) into members from
    (select m.id,m.user_id,m.display_name,m.authority,m.status,
      coalesce(u.email,m.email) as email,u.email_confirmed_at,m.scope,
      exists(select 1 from public.venue_members vm join public.venues v on v.id=vm.venue_id
        where vm.member_id=m.id and vm.left_at is null and v.closed_at is null and m.status in ('active','invited')) as counts_as_person
    from public.workspace_members m left join auth.users u on u.id=m.user_id where m.workspace_id=p_workspace
    order by case m.authority when 'owner' then 0 when 'collaborator' then 1 else 2 end,m.display_name,m.id
    limit 25 offset p_members_offset) m;
  select jsonb_build_object('total',(select count(*) from public.venues where workspace_id=p_workspace),'limit',25,'offset',p_venues_offset,
    'items',coalesce(jsonb_agg(to_jsonb(v)),'[]'::jsonb)) into venues from
    (select id,name,created_at,closed_at,(select count(*) from public.venue_members vm where vm.venue_id=v.id and vm.left_at is null) as current_placements
      from public.venues v where workspace_id=p_workspace order by created_at,id limit 25 offset p_venues_offset) v;
  select jsonb_build_object('total',(select count(*) from public.workspace_access_periods where workspace_id=p_workspace),'limit',25,'offset',p_periods_offset,
    'items',coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb)) into periods from
    (select id,kind,plan,venue_limit,starts_at,ends_at,revoked_at,reason,created_at from public.workspace_access_periods
      where workspace_id=p_workspace order by starts_at desc,id limit 25 offset p_periods_offset) p;
  return jsonb_build_object('generated_at',now(),'workspace',private.admin_workspace_json(w),
    'members',members,'venues',venues,'periods',periods,
    'activity',jsonb_build_object('last_shift_created_at',(select max(s.created_at) from public.shifts s join public.venues v on v.id=s.venue_id where v.workspace_id=p_workspace),
      'last_clock_in_at',(select max(c.clock_in_at) from public.shift_clock_records c join public.venues v on v.id=c.venue_id where v.workspace_id=p_workspace),
      'last_manager_sign_in_at',(select max(u.last_sign_in_at) from auth.users u join public.workspace_members m on m.user_id=u.id where m.workspace_id=p_workspace and m.status='active' and m.authority in ('owner','collaborator'))),
    'classification_reason',(select reason from private.admin_workspace_labels where workspace_id=p_workspace),
    'finance',null,'costs',null);
end;
$$;

create function public.admin_list_accounts(p_query text default '',p_status text default 'all',p_classification text default 'all',
  p_limit integer default 25,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_platform_admin();
  perform private.validate_admin_page(p_query,p_limit,p_offset);
  if p_status is null or p_status<>all(array['all','confirmed','unconfirmed','anonymous','deleted'])
    or p_classification is null or p_classification<>all(array['all','customer','internal','test','unclassified']) then
    raise exception 'admin_invalid_filter' using errcode='22023';
  end if;
  with filtered as materialized (select * from private.admin_account_rows a
    where (p_status='all' or a.status=p_status) and (p_classification='all' or a.classification=p_classification)
      and (btrim(coalesce(p_query,''))='' or position(lower(btrim(p_query)) in lower(coalesce(a.full_name,'')))>0
        or position(lower(btrim(p_query)) in lower(coalesce(a.email,'')))>0))
  select jsonb_build_object('generated_at',now(),'total',(select count(*) from filtered),'limit',p_limit,'offset',p_offset,
    'items',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from (select * from filtered order by created_at desc nulls last,id limit p_limit offset p_offset) a)) into result;
  return result;
end;
$$;

create function public.admin_get_account(p_account uuid,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a private.admin_account_rows; memberships jsonb;
begin
  perform private.require_platform_admin();
  perform private.validate_admin_page('',25,p_offset);
  select * into a from private.admin_account_rows where id=p_account;
  if not found then raise exception 'admin_not_found' using errcode='P0002'; end if;
  select jsonb_build_object('total',(select count(*) from public.workspace_members where user_id=p_account),'limit',25,'offset',p_offset,
    'items',coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb)) into memberships from
    (select m.id,w.id as workspace_id,w.name as workspace_name,w.deleted_at as workspace_deleted_at,m.display_name,m.authority,m.status,m.scope,
      (select count(*) from public.venues v where v.workspace_id=m.workspace_id
        and m.authority in ('owner','collaborator') and (m.authority='owner' or m.scope='all'
        or exists(select 1 from public.member_scope s where s.member_id=m.id and s.venue_id=v.id))) as managed_venues_total,
      (select coalesce(jsonb_agg(to_jsonb(v)),'[]'::jsonb) from
        (select v.id,v.name,v.closed_at from public.venues v where v.workspace_id=m.workspace_id
          and m.authority in ('owner','collaborator') and (m.authority='owner' or m.scope='all'
          or exists(select 1 from public.member_scope s where s.member_id=m.id and s.venue_id=v.id))
          order by v.name,v.id limit 25) v) as managed_venues,
      (select coalesce(jsonb_agg(jsonb_build_object('venue_id',v.id,'venue_name',v.name,'left_at',vm.left_at,'closed_at',v.closed_at)),'[]'::jsonb)
        from (select * from public.venue_members where member_id=m.id order by created_at,id limit 25) vm join public.venues v on v.id=vm.venue_id) as works,
      (select count(*) from public.venue_members where member_id=m.id) as works_total
    from public.workspace_members m join public.workspaces w on w.id=m.workspace_id where m.user_id=p_account
    order by w.name,m.id limit 25 offset p_offset) m;
  return jsonb_build_object('generated_at',now(),'account',to_jsonb(a),'memberships',memberships,
    'classification_reason',(select reason from private.admin_account_labels where user_id=p_account));
end;
$$;

revoke all on function private.platform_admin_eligible(),private.platform_admin_mfa_verified(),private.require_platform_admin(),
  private.admin_workspace_flags(private.admin_workspace_rows),private.admin_workspace_json(private.admin_workspace_rows),
  private.validate_admin_page(text,integer,integer) from public,anon,authenticated;
revoke all on function public.get_platform_admin_access(),public.admin_get_overview(),
  public.admin_list_workspaces(text,text,text,text,integer,integer),public.admin_get_workspace(uuid,integer,integer,integer),
  public.admin_list_accounts(text,text,text,integer,integer),public.admin_get_account(uuid,integer) from public,anon,authenticated;
grant execute on function public.get_platform_admin_access(),public.admin_get_overview(),
  public.admin_list_workspaces(text,text,text,text,integer,integer),public.admin_get_workspace(uuid,integer,integer,integer),
  public.admin_list_accounts(text,text,text,integer,integer),public.admin_get_account(uuid,integer) to authenticated;
