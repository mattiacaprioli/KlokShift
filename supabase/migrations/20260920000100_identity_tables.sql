-- Baseline — 2/N: identità e appartenenza.
--
--   profiles           l'account (una persona, valida fra più aziende)
--   workspaces         l'azienda
--   venues             le sedi dell'azienda
--   workspace_members  una persona nell'azienda: titolare, collaboratore o
--                      dipendente. Un solo asse al posto di staff_people +
--                      venue_access + venues.owner_id.
--   venue_members      in quali sedi lavora (l'organico)
--
-- authority e organico sono ortogonali: authority dice cosa puoi fare, le righe
-- di venue_members dicono dove lavori. Un titolare «in turno» è un membro
-- owner con una riga in venue_members, non un caso speciale.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- Niente `role` e niente `plan`: il ruolo non è un confine di sicurezza (chi è
-- cosa lo dicono le appartenenze) e il piano appartiene all'azienda. Niente FK
-- verso auth.users: l'eliminazione account anonimizza la riga, non la cancella.
create table public.profiles (
  id                  uuid primary key,
  full_name           text,
  avatar_url          text,
  phone               text,
  bio                 text,
  city                text,
  birth_day           smallint,
  birth_month         smallint,
  onboarding_complete boolean not null default false,
  intro_seen          boolean not null default false,
  notification_prefs  jsonb   not null default '{}'::jsonb,
  deleted_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Compleanno = giorno + mese e mai una `date`: chi gestisce legge la riga
  -- intera, quindi l'anno non deve esistere.
  constraint profiles_birthday_valid check (
    (birth_day is null and birth_month is null)
    or (birth_month between 1 and 12 and birth_day >= 1 and birth_day <= case birth_month
          when 2 then 29 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end)
  )
);
alter table public.profiles enable row level security;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.update_updated_at();

-- ---------------------------------------------------------------------------
-- workspaces e venues
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (btrim(name) <> ''),
  -- Il piano è dell'azienda (chi paga), non di chi guarda. Non scrivibile dal
  -- client: nessuna policy di scrittura e nessun GRANT.
  plan       text not null default 'pro' check (plan in ('free', 'pro')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.workspaces enable row level security;

create table public.venues (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  name                text not null check (btrim(name) <> ''),
  address             text,
  city                text,
  cuisine_type        text,
  logo_url            text,
  description         text,
  staff_sees_planning boolean not null default true,
  closed_at           timestamptz,
  created_at          timestamptz not null default now(),
  -- Per le FK composite che impediscono di mescolare aziende diverse.
  constraint venues_id_workspace_uq unique (id, workspace_id)
);
create index venues_workspace_idx on public.venues (workspace_id);
alter table public.venues enable row level security;

create or replace function public.venues_workspace_is_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'venue_workspace_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger venues_workspace_immutable before update on public.venues
  for each row execute function public.venues_workspace_is_immutable();

-- ---------------------------------------------------------------------------
-- workspace_members
-- ---------------------------------------------------------------------------
create table public.workspace_members (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  -- null = scheda preparata dalla sede per una persona che non ha (ancora)
  -- un account. Si aggancia da sola quando l'email confermata coincide.
  user_id        uuid references public.profiles (id) on delete set null,
  email          text,
  display_name   text not null check (btrim(display_name) <> ''),
  phone          text,
  authority      public.member_authority not null default 'none',
  status         public.member_status    not null default 'active',
  -- Permessi del collaboratore. Il titolare ha tutto per costruzione (vedi la
  -- view private.member_venue_grants) e la persona senza authority niente.
  can_shifts     boolean not null default false,
  can_staff      boolean not null default false,
  can_hours      boolean not null default false,
  can_documents  boolean not null default false,
  can_venue      boolean not null default false,
  -- Ambito: tutte le sedi (comprese quelle future) oppure un elenco.
  scope          public.venue_scope not null default 'all',
  -- Impostata quando l'aggancio automatico trova che quell'account è già
  -- presente in azienda con un'altra scheda: il titolare deve unirle a mano.
  link_conflict_at timestamptz,
  left_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint wm_id_workspace_uq unique (id, workspace_id),
  constraint wm_email_format check (
    email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  constraint wm_perms_only_collaborator check (
    authority = 'collaborator' or not (can_shifts or can_staff or can_hours or can_documents or can_venue)
  ),
  -- Chi ha un potere di gestione e risulta attivo ha un account: senza, non
  -- esiste nessun auth.uid() a cui dare i permessi.
  constraint wm_active_manager_has_account check (
    authority = 'none' or status <> 'active' or user_id is not null
  ),
  constraint wm_left_coherent check ((status = 'left') = (left_at is not null))
);
create unique index wm_workspace_user_uq on public.workspace_members (workspace_id, user_id)
  where user_id is not null;
-- Incondizionata (anche fra gli usciti): chi torna si ripristina invece di
-- duplicarsi, e lo storico resta agganciato a un solo id.
create unique index wm_workspace_email_uq on public.workspace_members (workspace_id, lower(email))
  where email is not null;
create index wm_user_idx on public.workspace_members (user_id) where user_id is not null;
create index wm_email_unlinked_idx on public.workspace_members (lower(email))
  where user_id is null and email is not null;
alter table public.workspace_members enable row level security;
create trigger workspace_members_updated_at before update on public.workspace_members
  for each row execute function public.update_updated_at();

create or replace function public.workspace_members_workspace_is_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'member_workspace_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger workspace_members_workspace_immutable before update on public.workspace_members
  for each row execute function public.workspace_members_workspace_is_immutable();

-- Almeno un titolare attivo per azienda, controllato a fine transazione così
-- `transfer_ownership` può promuovere e retrocedere nello stesso COMMIT.
-- security definer: deve vedere tutte le righe a prescindere dalla RLS di chi scrive.
create or replace function public.workspace_needs_an_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid := coalesce(new.workspace_id, old.workspace_id);
begin
  if exists (select 1 from public.workspaces w where w.id = v_ws and w.deleted_at is null)
     and not exists (
       select 1 from public.workspace_members m
        where m.workspace_id = v_ws and m.authority = 'owner' and m.status = 'active'
     )
  then
    raise exception 'workspace_needs_an_owner' using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger workspace_members_need_an_owner
  after update or delete on public.workspace_members
  deferrable initially deferred
  for each row execute function public.workspace_needs_an_owner();

-- Dati sensibili separati: la RLS filtra righe e non colonne, e un collaboratore
-- con «Staff» non deve leggere via API ore da contratto e note di chi gestisce.
create table public.member_hr (
  member_id       uuid primary key references public.workspace_members (id) on delete cascade,
  note            text,
  contract_hours  numeric(5,2),
  contract_period text,
  updated_at      timestamptz not null default now(),
  constraint member_hr_hours_ck check (contract_hours is null or (contract_hours > 0 and contract_hours <= 400)),
  constraint member_hr_period_ck check (contract_period is null or contract_period in ('day', 'week', 'month')),
  constraint member_hr_pair_ck check ((contract_hours is null) = (contract_period is null))
);
alter table public.member_hr enable row level security;
create trigger member_hr_updated_at before update on public.member_hr
  for each row execute function public.update_updated_at();

-- Ambito «selected» del collaboratore.
create table public.member_scope (
  member_id    uuid not null,
  venue_id     uuid not null,
  workspace_id uuid not null,
  primary key (member_id, venue_id),
  foreign key (member_id, workspace_id) references public.workspace_members (id, workspace_id) on delete cascade,
  foreign key (venue_id, workspace_id)  references public.venues (id, workspace_id) on delete cascade
);
create index member_scope_venue_idx on public.member_scope (venue_id);
alter table public.member_scope enable row level security;

-- Inviti in uscita. Nessuna policy: li leggono e scrivono solo le RPC e le Edge
-- Function con service role. Il token sta hashato (SHA-256): l'email lo porta in
-- chiaro, il DB non lo conosce.
create table public.member_invites (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.workspace_members (id) on delete cascade,
  channel       text not null check (channel in ('email', 'token')),
  token_hash    text,
  expires_at    timestamptz,
  consumed_at   timestamptz,
  sent_count    integer not null default 0,
  last_sent_at  timestamptz,
  day_started_at timestamptz,
  day_count     integer not null default 0,
  created_at    timestamptz not null default now(),
  constraint member_invites_token_ck check (channel <> 'token' or token_hash is not null or consumed_at is not null)
);
create unique index member_invites_token_uq on public.member_invites (token_hash) where token_hash is not null;
-- Un invito per persona: rimandarlo aggiorna la riga (e fa morire il link precedente).
create unique index member_invites_member_uq on public.member_invites (member_id);
alter table public.member_invites enable row level security;

-- ---------------------------------------------------------------------------
-- venue_members: l'organico
-- ---------------------------------------------------------------------------
create table public.venue_members (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null,
  venue_id        uuid not null,
  workspace_id    uuid not null,
  employment_type public.employment_type not null default 'a_chiamata',
  -- null = in organico; valorizzato = uscito da questa sede (resta lo storico).
  left_at         timestamptz,
  created_at      timestamptz not null default now(),
  constraint venue_members_member_venue_uq unique (member_id, venue_id),
  -- Per le FK composite di venue_member_roles e dei turni.
  constraint venue_members_id_venue_uq unique (id, venue_id),
  foreign key (member_id, workspace_id) references public.workspace_members (id, workspace_id) on delete cascade,
  foreign key (venue_id, workspace_id)  references public.venues (id, workspace_id) on delete cascade
);
create index venue_members_venue_idx on public.venue_members (venue_id) where left_at is null;
create index venue_members_member_idx on public.venue_members (member_id);
alter table public.venue_members enable row level security;

-- ---------------------------------------------------------------------------
-- Mansioni della sede
-- ---------------------------------------------------------------------------
create table public.venue_roles (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references public.venues (id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  sort_order  integer not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint venue_roles_id_venue_uq unique (id, venue_id)
);
create index venue_roles_venue_idx on public.venue_roles (venue_id);
alter table public.venue_roles enable row level security;

create table public.venue_member_roles (
  venue_member_id uuid not null,
  venue_id        uuid not null,
  role_id         uuid not null,
  created_at      timestamptz not null default now(),
  primary key (venue_member_id, role_id),
  -- La mansione deve essere della stessa sede della riga di organico.
  foreign key (venue_member_id, venue_id) references public.venue_members (id, venue_id) on delete cascade,
  foreign key (role_id, venue_id) references public.venue_roles (id, venue_id) on delete cascade
);
create index venue_member_roles_role_idx on public.venue_member_roles (role_id);
alter table public.venue_member_roles enable row level security;
