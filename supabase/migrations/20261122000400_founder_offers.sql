-- Clienti fondatori (docs/MONETIZATION.md §2-bis, decisione del 22/11): le
-- prime 10 aziende che pagano hanno il 30% su fascia e sedi per 24 mesi dal
-- primo addebito. Lo sconto vive su Paddle (`dsc_…`, ricorrente senza fine);
-- qui si decide a chi proporlo e quando finisce.
--
-- - Il posto lo conta solo il database: lo sconto su Paddle non ha limite d'uso
--   (non è chiaro se i rinnovi lo consumino, B0 in docs/TEST-BILLING-FOUNDERS.md),
--   e lo propone soltanto il server. Contano le righe
--   attive e finite (qualunque origine) e i posti riservati a mano dal
--   fondatore. Il posto si prende con l'avviso firmato del primo abbonamento,
--   non con la richiesta di acquisto. Posti e idoneità sono **per ambiente**
--   (sandbox e live stanno nello stesso progetto): le prove in sandbox non
--   prendono posti veri; i posti riservati dal fondatore sono live.
-- - Sconto automatico solo a chi non ha mai avuto un abbonamento né una
--   gratuità a vita («non si somma alla gratuità a vita»), finché ci sono
--   posti. Il fondatore può riservare un posto (`grant_founder_offer`), con
--   motivo e registro come le altre concessioni.
-- - 24 mesi di calendario in Europe/Rome dal primo periodo (come l'archivio in
--   workspace_access_at). Pausa, cambi di fascia o di ciclo non li spostano.
--   60 giorni prima i titolari lo sanno (`founder_offer_ending`, senza importi);
--   nelle 24 ore prima la Edge Function `billing-scheduled` toglie lo sconto
--   (`billing_founder_offers_due`) e l'avviso firmato che segue chiude la riga.
--
-- Le funzioni ricopiate partono dall'ultima definizione (20261122000100 per
-- checkout, avvisi e interventi; 20261006000200 per snapshot e controllo del
-- fondatore), con le sole righe indicate cambiate; stessa firma, quindi i
-- privilegi restano.

-- Il tipo nuovo si usa solo dentro corpi plpgsql: un valore aggiunto a un enum
-- non è utilizzabile come letterale nella stessa transazione. Prefisso non
-- `shift_`: come `billing_change_reminder`, cade nella categoria di ripiego.
alter type public.notification_type add value if not exists 'founder_offer_ending';

-- 1. Le regole, in un posto solo.
create function private.founder_offer_seats()
returns integer language sql immutable set search_path = '' as $$
  select 10
$$;
create function private.founder_offer_percent()
returns integer language sql immutable set search_path = '' as $$
  select 30
$$;
-- 24 mesi di calendario sull'ora italiana: il 1° dicembre 2026 alle 00:00
-- finisce il 1° dicembre 2028 alle 00:00, anche a cavallo dell'ora legale.
create function private.founder_offer_end(p_start timestamptz)
returns timestamptz language sql immutable set search_path = '' as $$
  select ((p_start at time zone 'Europe/Rome') + interval '24 months') at time zone 'Europe/Rome'
$$;
revoke all on function private.founder_offer_seats(), private.founder_offer_percent(),
  private.founder_offer_end(timestamptz) from public, anon, authenticated;

-- 2. Catalogo degli sconti, per ambiente come i prezzi: `selectable` è quello
--    da proporre ai nuovi acquisti, i vecchi restano riconoscibili negli avvisi.
create table private.billing_discounts (
  environment text not null check (environment in ('sandbox', 'live')),
  discount_id text not null check (discount_id ~ '^dsc_[a-z0-9]+$'),
  kind text not null check (kind = 'founder'),
  selectable boolean not null default true,
  primary key (environment, discount_id)
);
create unique index billing_discounts_selectable_uq
  on private.billing_discounts (environment, kind) where selectable;
revoke all on private.billing_discounts from public, anon, authenticated;

-- Sconto sandbox creato il 22/11 (B0): 30%, ricorrente senza fine, sugli 8
-- prezzi di fasce e sede aggiuntiva. Quello live arriverà con la sua migration.
insert into private.billing_discounts (environment, discount_id, kind) values
  ('sandbox', 'dsc_01m820gne44grwwhcyekfe10ws', 'founder');

-- 3. Il posto dell'azienda, per ambiente: sandbox e live stanno nello stesso
--    progetto, e una prova in sandbox non deve prendere uno dei 10 posti veri
--    né rendere l'azienda non idonea in live. Una riga per azienda e ambiente,
--    per sempre: chi l'ha avuto e l'ha finito non lo riprende (§2-bis).
--      reserved  riservato dal fondatore (sempre live), in attesa del primo
--                abbonamento;
--      active    sconto sull'abbonamento, fino a `ends_at`;
--      ended     tolto (scadenza o disdetta): il posto resta contato.
create table public.workspace_founder_offers (
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  environment text not null check (environment in ('sandbox', 'live')),
  source text not null check (source in ('auto', 'founder')),
  status text not null check (status in ('reserved', 'active', 'ended')),
  reserved_at timestamptz,
  activated_at timestamptz,
  ends_at timestamptz,
  ended_at timestamptz,
  subscription_id uuid references public.billing_subscriptions (id) on delete restrict,
  -- Avviso dei 60 giorni già mandato: una volta sola.
  end_notice_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, environment),
  constraint workspace_founder_offer_reserved check (
    status <> 'reserved' or (source = 'founder' and reserved_at is not null)),
  constraint workspace_founder_offer_active check (
    status = 'reserved' or (activated_at is not null and ends_at is not null and ends_at > activated_at)),
  constraint workspace_founder_offer_ended check ((status = 'ended') = (ended_at is not null))
);
alter table public.workspace_founder_offers enable row level security;
create index workspace_founder_offers_due_idx on public.workspace_founder_offers (environment, ends_at)
  where status = 'active';
create trigger workspace_founder_offers_updated_at
  before update on public.workspace_founder_offers
  for each row execute function public.update_updated_at();
revoke all on public.workspace_founder_offers from public, anon, authenticated;
grant select on public.workspace_founder_offers to service_role;

-- 4. Posti presi in un ambiente: attivi e finiti, più i riservati dal fondatore.
create function private.founder_seats_taken(p_environment text)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.workspace_founder_offers
   where environment = p_environment
     and (status in ('active', 'ended') or (status = 'reserved' and source = 'founder'))
$$;

-- L'azienda avrebbe lo sconto al prossimo acquisto in quest'ambiente? Un posto
-- riservato vale sempre; altrimenti mai una riga e mai un abbonamento (anche
-- disdetto) nello stesso ambiente, mai una gratuità a vita (anche revocata:
-- quella è reale in ogni ambiente), e un posto libero.
create function private.founder_offer_open(p_workspace uuid, p_environment text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.workspace_founder_offers
                  where workspace_id = p_workspace and environment = p_environment
                    and status = 'reserved') then true
    when exists (select 1 from public.workspace_founder_offers
                  where workspace_id = p_workspace and environment = p_environment)
      or exists (select 1 from public.billing_subscriptions
                  where workspace_id = p_workspace and environment = p_environment)
      or exists (select 1 from public.workspace_access_periods
                  where workspace_id = p_workspace and kind = 'complimentary_lifetime') then false
    else private.founder_seats_taken(p_environment) < private.founder_offer_seats()
  end
$$;

-- Lo sconto da mettere nel checkout di quest'ambiente, o null.
create function private.founder_offer_discount(p_workspace uuid, p_environment text)
returns text language sql stable security definer set search_path = '' as $$
  select d.discount_id from private.billing_discounts d
   where d.environment = p_environment and d.kind = 'founder' and d.selectable
     and private.founder_offer_open(p_workspace, p_environment)
$$;
revoke all on function private.founder_seats_taken(text), private.founder_offer_open(uuid, text),
  private.founder_offer_discount(uuid, text) from public, anon, authenticated;

-- 5. L'avviso firmato aggiorna il posto del suo ambiente. Si chiama da
--    billing_apply_event con l'abbonamento appena scritto, sotto il lock
--    dell'azienda.
--    - sconto fondatori sull'abbonamento (non disdetto): la riga nuova o
--      riservata diventa attiva dal primo periodo; una attiva non si tocca
--      (avvisi ripetuti, rinnovi e cambi non spostano la scadenza); una finita
--      dello stesso abbonamento torna attiva con la sua scadenza di prima (lo
--      sconto è ricomparso su Paddle: il runner guarda solo le righe attive e,
--      se la scadenza è passata, lo toglie di nuovo); i 24 mesi non ripartono;
--    - sconto sparito o abbonamento disdetto: la riga attiva di
--      quell'abbonamento finisce.
--    Il posto si onora anche oltre il decimo: lo sconto il cliente l'ha visto
--    nel checkout (due acquisti preparati insieme sul nono posto).
create function private.founder_offer_sync(p_subscription uuid, p_data jsonb, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.billing_subscriptions;
  o public.workspace_founder_offers;
  v_founder boolean;
  v_start timestamptz;
begin
  select * into s from public.billing_subscriptions where id = p_subscription;
  if not found then
    return;
  end if;
  v_founder := s.status <> 'canceled' and exists (
    select 1 from private.billing_discounts d
     where d.environment = s.environment and d.kind = 'founder'
       and d.discount_id = p_data #>> '{discount,id}');
  select * into o from public.workspace_founder_offers
   where workspace_id = s.workspace_id and environment = s.environment for update;

  if v_founder then
    if found and o.status = 'ended' then
      if o.subscription_id = s.id then
        update public.workspace_founder_offers set status = 'active', ended_at = null
         where workspace_id = s.workspace_id and environment = s.environment;
      end if;
      return;
    end if;
    if found and o.status <> 'reserved' then
      return;
    end if;
    -- Il primo addebito; senza (avviso parziale) l'inizio del periodo in corso.
    v_start := coalesce((p_data ->> 'first_billed_at')::timestamptz, s.current_period_starts_at);
    if v_start is null then
      return;
    end if;
    if found then
      update public.workspace_founder_offers
         set status = 'active', activated_at = v_start,
             ends_at = private.founder_offer_end(v_start), subscription_id = s.id
       where workspace_id = s.workspace_id and environment = s.environment;
    else
      insert into public.workspace_founder_offers (workspace_id, environment, source, status,
        activated_at, ends_at, subscription_id)
      values (s.workspace_id, s.environment, 'auto', 'active', v_start,
        private.founder_offer_end(v_start), s.id);
    end if;
  elsif found and o.status = 'active' and o.subscription_id = s.id then
    update public.workspace_founder_offers
       set status = 'ended', ended_at = p_at
     where workspace_id = s.workspace_id and environment = s.environment;
  end if;
end;
$$;
revoke all on function private.founder_offer_sync(uuid, jsonb, timestamptz) from public, anon, authenticated;

-- 6. Lettura per il titolare (pagina Piano), per l'ambiente in cui il web fa
--    gli acquisti: stato, fine, percentuale e se il prossimo acquisto avrebbe
--    lo sconto. Nessun conteggio dei posti.
create function public.get_founder_offer(p_workspace uuid, p_environment text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  o public.workspace_founder_offers;
begin
  if p_environment is null or p_environment not in ('sandbox', 'live') then
    raise exception 'billing_invalid_environment' using errcode = '22023';
  end if;
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.owns_workspace(p_workspace) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into o from public.workspace_founder_offers
   where workspace_id = p_workspace and environment = p_environment;
  return jsonb_build_object(
    'status', o.status,
    'ends_at', o.ends_at,
    'percent', private.founder_offer_percent(),
    'eligible', private.founder_offer_discount(p_workspace, p_environment) is not null
      and not exists (select 1 from public.billing_subscriptions
                       where workspace_id = p_workspace and status <> 'canceled'));
end;
$$;
revoke all on function public.get_founder_offer(uuid, text) from public, anon;
grant execute on function public.get_founder_offer(uuid, text) to authenticated;

-- 7. Gli sconti in scadenza entro 24 ore, per la Edge Function che li toglie
--    (solo service role). La riga resta attiva finché l'avviso firmato non
--    dice che lo sconto non c'è più.
create function public.billing_founder_offers_due(p_environment text)
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('workspace_id', o.workspace_id,
           'paddle_subscription_id', s.provider_subscription_id, 'ends_at', o.ends_at)
    from public.workspace_founder_offers o
    join public.billing_subscriptions s on s.id = o.subscription_id
   where o.environment = p_environment and o.status = 'active'
     and s.environment = p_environment and s.status <> 'canceled'
     and o.ends_at <= now() + interval '24 hours'
   order by o.ends_at, o.workspace_id
$$;
revoke all on function public.billing_founder_offers_due(text) from public, anon, authenticated;
grant execute on function public.billing_founder_offers_due(text) to service_role;

-- 8. Avviso dei 60 giorni (stesso preavviso degli aumenti, §6), una volta per
--    azienda, a ogni titolare attivo. Data per esteso («il 1° dicembre»,
--    «il 15 dicembre»), nessun importo.
create function private.rome_long_date(p_at timestamptz)
returns text language sql immutable set search_path = '' as $$
  select case when extract(day from l) = 1 then '1°' else to_char(l, 'FMDD') end || ' '
      || (array['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio',
                'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'])[extract(month from l)::integer]
      || ' ' || to_char(l, 'YYYY')
    from (select p_at at time zone 'Europe/Rome' as l) x
$$;

create function private.queue_founder_offer_notices(p_at timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare
  c record;
  v_user uuid;
  v_count integer := 0;
begin
  for c in
    select o.workspace_id, o.environment, o.ends_at
      from public.workspace_founder_offers o
      join public.workspaces w on w.id = o.workspace_id
     where o.status = 'active' and o.end_notice_at is null
       and o.ends_at > p_at and o.ends_at - interval '60 days' <= p_at
       and w.deleted_at is null
     for update of o
  loop
    begin
      for v_user in
        select m.user_id from public.workspace_members m
         where m.workspace_id = c.workspace_id and m.authority = 'owner' and m.status = 'active'
           and m.user_id is not null
      loop
        perform private.notify(v_user, 'founder_offer_ending',
          'Lo sconto fondatori finisce il ' || private.rome_long_date(c.ends_at),
          'Dal rinnovo successivo si paga il listino in vigore. Puoi cambiare o disdire dalla pagina Piano.',
          c.workspace_id);
      end loop;
      update public.workspace_founder_offers set end_notice_at = p_at
       where workspace_id = c.workspace_id and environment = c.environment;
      v_count := v_count + 1;
    exception when others then
      raise warning 'queue_founder_offer_notices: avviso di % non riuscito (%)', c.workspace_id, sqlstate;
    end;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.rome_long_date(timestamptz),
  private.queue_founder_offer_notices(timestamptz) from public, anon, authenticated;

-- Ogni giorno alle 7:30 UTC (8:30 o 9:30 in Italia), dopo i promemoria
-- dell'archivio. Se pg_cron non c'è (banco locale) la migration non si ferma.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('founder-offer-notices', '30 7 * * *',
    'select private.queue_founder_offer_notices()');
exception when others then
  raise notice 'pg_cron non disponibile: avvisi dello sconto fondatori non programmati (%).', sqlerrm;
end $$;

-- 9. Registro degli interventi: il posto riservato dal fondatore.
alter table private.admin_operations drop constraint admin_operations_action_check;
alter table private.admin_operations add constraint admin_operations_action_check
  check (action in ('grant_lifetime', 'set_classification', 'add_note', 'delete_data',
    'plan_band_migration', 'grant_founder_offer'));

-- 10. Funzioni ricopiate.

-- 10a. Copia integrale di 20261006000200_founder_concessions.sql: anche il posto
--      fondatori dell'azienda, così la revisione cambia quando si riserva.
create or replace function private.admin_workspace_snapshot(p_workspace uuid)
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
      order by p.starts_at desc,p.created_at desc,p.id desc limit 1),
    -- Nuovo: il posto fondatori live (quello vero; la sandbox è solo di prova).
    'founder_offer',(select jsonb_build_object('status',o.status,'source',o.source,
      'reserved_at',o.reserved_at,'activated_at',o.activated_at,'ends_at',o.ends_at,'ended_at',o.ended_at)
      from public.workspace_founder_offers o where o.workspace_id=w.id and o.environment='live'))
  from public.workspaces w left join public.workspace_commercial_state c on c.workspace_id=w.id
  left join private.admin_workspace_labels l on l.workspace_id=w.id
  left join private.admin_workspace_storage s on s.workspace_id=w.id where w.id=p_workspace;
$$;

-- 10b. Copia integrale di 20261006000200_founder_concessions.sql: con i posti
--      presi in tutto (fuori dallo snapshot: la revisione di un'azienda non
--      deve cambiare quando un'altra prende un posto).
create or replace function public.admin_get_workspace_control(p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare snapshot jsonb; revision text;
begin
  perform private.require_platform_admin();
  select private.admin_workspace_snapshot(w.id),private.admin_workspace_revision(w.id)
    into snapshot,revision from public.workspaces w where w.id=p_workspace and w.deleted_at is null;
  if not found then raise exception 'admin_not_found' using errcode='P0002'; end if;
  return jsonb_build_object('generated_at',now(),'target_id',p_workspace,'revision',revision,'snapshot',snapshot,
    'founder_seats',jsonb_build_object('taken',private.founder_seats_taken('live'),'total',private.founder_offer_seats()));
end;
$$;

-- 10c. Copia integrale di 20261122000100_plan_bands.sql: il fondatore riserva un posto.
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
  if p_action is null or p_action not in ('grant_lifetime','set_classification','add_note',
    'grant_founder_offer') then
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
  elsif p_action='grant_founder_offer' then
    -- Nuovo: il fondatore riserva un posto vero (live). Solo a un'azienda che
    -- non ha mai avuto un posto o un abbonamento live, né una gratuità a vita,
    -- e fino a 10 posti live.
    if p_classification is not null or p_plan is not null or p_venue_limit is not null or p_document_limit_bytes is not null then
      raise exception 'admin_invalid_operation' using errcode='22023';
    end if;
    -- Senza lo sconto live in catalogo il posto resterebbe preso senza poter
    -- mai arrivare a un checkout scontato.
    if not exists(select 1 from private.billing_discounts
      where environment='live' and kind='founder' and selectable) then
      raise exception 'founder_offer_unavailable' using errcode='23514';
    end if;
    -- Due riserve in parallelo non superano i posti.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('founder_offer_seats',202611220400));
    if exists(select 1 from public.workspace_founder_offers where workspace_id=p_workspace and environment='live')
      or exists(select 1 from public.billing_subscriptions where workspace_id=p_workspace and environment='live')
      or exists(select 1 from public.workspace_access_periods where workspace_id=p_workspace
        and kind='complimentary_lifetime') then
      raise exception 'founder_offer_not_eligible' using errcode='23514';
    end if;
    if private.founder_seats_taken('live')>=private.founder_offer_seats() then
      raise exception 'founder_seats_full' using errcode='23514';
    end if;
    insert into public.workspace_founder_offers(workspace_id,environment,source,status,reserved_at)
    values(p_workspace,'live','founder','reserved',applied_at);
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
-- 10d. Copia integrale di 20261122000100_plan_bands.sql: il checkout porta lo sconto.
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
  v_discount text;
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
  -- Nuovo: lo sconto fondatori, se l'azienda ha il posto o c'è ancora un posto
  -- libero per lei. Non prende il posto: lo prende l'avviso del primo abbonamento.
  v_discount := private.founder_offer_discount(p_workspace, p_environment);

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
    end,
    'discount_id', v_discount
  );
end;
$$;
-- 10e. Copia integrale di 20261122000100_plan_bands.sql: l'avviso aggiorna il posto.
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
  -- Nuovo: il posto fondatori segue lo sconto dell'abbonamento.
  perform private.founder_offer_sync(s.id, d, v_occurred);
  insert into private.billing_events (environment, event_id, event_type, occurred_at,
    payload, outcome, subscription_id)
  values (p_environment, v_event_id, v_type, v_occurred, p_event, 'applied', s.id);
  return jsonb_build_object('outcome', 'applied', 'subscription_id', s.id,
    'workspace_id', v_workspace);
end;
$$;

-- 10. Il giro ogni 10 minuti parte anche quando c'è uno sconto fondatori da
--     togliere: stessa funzione di 20261101000300, con una condizione in più
--     (`billing_founder_offers_due`, in entrambi gli ambienti: quale
--     chiamare lo sa la Edge Function, dalla sua configurazione). Stessa firma,
--     quindi i privilegi restano.
create or replace function private.run_scheduled_billing_changes()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_secret text;
begin
  perform private.queue_scheduled_billing_work(now());
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'push_hook_secret' limit 1;
  if v_secret is not null and (exists (
       select 1 from public.billing_scheduled_changes
        where (status = 'pending' and effective_at > now()
               and effective_at - private.billing_schedule_window() <= now()
               and next_attempt_at <= now())
           or (reminder_notified_at is not null and reminder_emailed_at is null
               and reminder_email_attempts < 5)
           or (alert_kind is not null and alert_emailed_at is null
               and alert_email_attempts < 5 and reviewed_at is null))
     or exists (select 1 from public.billing_founder_offers_due('sandbox'))
     or exists (select 1 from public.billing_founder_offers_due('live'))) then
    perform net.http_post(
      url     := 'https://rmlobxjlqlpixkvrzmfg.supabase.co/functions/v1/billing-scheduled',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
      body    := '{}'::jsonb);
  end if;
end;
$$;
