-- Accettazione di termini e accordo sul trattamento dei dati (DPA).
--
-- È il registro dell'accordo ex art. 28, par. 9 GDPR, concluso in forma
-- elettronica: chi (un titolare), per quale azienda, quale versione, quando.
-- La versione in vigore vale per la coppia termini + DPA e vive in un solo
-- punto qui (`private.current_legal_version`) e in uno nel client
-- (`src/features/legal/version.ts`): gemelli manuali, cambiano insieme.
--
-- Il server non blocca le operazioni di un'azienda che non ha accettato, ed è
-- voluto: il blocco sta nella vista di gestione (app e dashboard), così turni e
-- timbrature del team non si fermano per un clic che manca al titolare.
-- Spec: docs/superpowers/specs/2026-10-31-dpa-e-pagine-legali-design.md.

create table private.legal_acceptances (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references public.profiles(id),
  version      text not null,
  accepted_at  timestamptz not null default now(),
  unique (workspace_id, version)
);
alter table private.legal_acceptances enable row level security;

create function private.current_legal_version()
returns text language sql immutable set search_path = '' as $$ select '1' $$;

create function public.accept_legal_terms(p_workspace uuid, p_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_version is distinct from private.current_legal_version() then
    raise exception 'legal_version_outdated' using errcode = '23514';
  end if;
  -- Accetta per conto dell'azienda solo chi la rappresenta: un titolare attivo.
  if not exists (
    select 1 from public.workspace_members m
      join public.workspaces w on w.id = m.workspace_id
     where m.workspace_id = p_workspace and m.user_id = v_uid
       and m.authority = 'owner' and m.status = 'active' and w.deleted_at is null
  ) then
    raise exception 'owner_only' using errcode = '42501';
  end if;

  insert into private.legal_acceptances (workspace_id, user_id, version)
  values (p_workspace, v_uid, p_version)
  on conflict (workspace_id, version) do nothing;
end;
$$;

-- Le aziende che chi gestisce non può ancora usare: nessun titolare ha accettato
-- la versione in vigore. Chi ci lavora soltanto (authority none) non compare mai.
create function public.get_pending_legal_acceptances()
returns table (workspace_id uuid, workspace_name text, can_accept boolean)
language sql stable security definer set search_path = '' as $$
  select w.id, w.name, m.authority = 'owner'
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
   where m.user_id = (select auth.uid())
     and m.status = 'active'
     and m.authority in ('owner', 'collaborator')
     and w.deleted_at is null
     and not exists (
       select 1 from private.legal_acceptances a
        where a.workspace_id = w.id and a.version = private.current_legal_version())
   order by w.name;
$$;

-- `create_workspace` accetta nella stessa transazione: un'azienda nata dal form
-- con la casella non passa mai dal blocco. Senza versione (client vecchio)
-- nasce lo stesso e il blocco chiederà l'accettazione al primo accesso.
drop function public.create_workspace(text);

create function public.create_workspace(p_name text, p_legal_version text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := (select auth.uid());
  v_ws   uuid;
  v_name text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'name_required' using errcode = '23514';
  end if;
  if p_legal_version is not null and p_legal_version <> private.current_legal_version() then
    raise exception 'legal_version_outdated' using errcode = '23514';
  end if;
  if (select count(*) from public.workspaces w
       where w.created_by = v_uid and w.deleted_at is null) >= 10 then
    raise exception 'workspace_limit' using errcode = '23514';
  end if;

  -- Rete di sicurezza: il profilo di norma lo ha già creato il trigger su auth.users.
  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;

  insert into public.workspaces (name, created_by) values (btrim(p_name), v_uid)
  returning id into v_ws;

  select coalesce(nullif(btrim(p.full_name), ''), 'Titolare') into v_name
    from public.profiles p where p.id = v_uid;

  insert into public.workspace_members (workspace_id, user_id, display_name, authority, status)
  values (v_ws, v_uid, v_name, 'owner', 'active');

  if p_legal_version is not null then
    insert into private.legal_acceptances (workspace_id, user_id, version)
    values (v_ws, v_uid, p_legal_version);
  end if;

  return v_ws;
end;
$$;

grant execute on function
  public.create_workspace(text, text),
  public.accept_legal_terms(uuid, text),
  public.get_pending_legal_acceptances()
to authenticated;
