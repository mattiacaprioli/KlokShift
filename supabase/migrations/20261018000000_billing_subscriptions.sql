-- M09, primo blocco: gli abbonamenti Paddle diventano periodi di accesso.
--
-- Il diritto dell'azienda resta calcolato da private.workspace_access_at sui
-- periodi: un abbonamento non è un secondo motore, produce righe `subscription`
-- (periodo pagato) e `payment_grace` (7 giorni dopo un rinnovo non riuscito).
-- Capacità, sola lettura, finestra di rettifica e archivio valgono così senza
-- altre modifiche. Regole: docs/MONETIZATION.md §2, §4, §5.
--
-- Solo eventi verificati: la Edge Function controlla la firma di Paddle e passa
-- l'evento grezzo a billing_apply_event (service role). Il ritorno dal checkout
-- nel browser non concede nulla. Nessuna scrittura o lettura diretta dal client.

-- 1. Catalogo: quale prezzo Paddle è quale voce del listino. Per ambiente,
--    perché sandbox e live hanno identificativi diversi. `selectable` indica il
--    prezzo da proporre ai nuovi acquisti; i vecchi restano per gli abbonati.
create table private.billing_prices (
  environment text not null check (environment in ('sandbox', 'live')),
  price_id text not null check (price_id ~ '^pri_[a-z0-9]+$'),
  item text not null check (item in ('base', 'team', 'extra_venue')),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  selectable boolean not null default true,
  primary key (environment, price_id)
);
create unique index billing_prices_selectable_uq
  on private.billing_prices (environment, item, billing_interval) where selectable;
revoke all on private.billing_prices from public, anon, authenticated;

-- Catalogo sandbox creato il 18/10 (plans/MONETIZATION-AND-FOUNDER-DASHBOARD.md, M08).
insert into private.billing_prices (environment, price_id, item, billing_interval) values
  ('sandbox', 'pri_01m577s3dchg2ctcrenkderz05', 'base', 'month'),
  ('sandbox', 'pri_01m577th8zt8x41cxk2p8m5n63', 'base', 'year'),
  ('sandbox', 'pri_01m577vzt1b6qkyyf80pnq4aj9', 'team', 'month'),
  ('sandbox', 'pri_01m577wqj8atr0sjvy8xhybwf1', 'team', 'year'),
  ('sandbox', 'pri_01m577z2zz69jyw4r3hm53warm', 'extra_venue', 'month'),
  ('sandbox', 'pri_01m577zzw0kv3c91yqttd0kk6k', 'extra_venue', 'year');

-- 2. L'abbonamento, copia dell'ultimo stato verificato presso Paddle.
--    `on delete restrict`: la storia dei pagamenti non sparisce con l'azienda.
create table public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  environment text not null check (environment in ('sandbox', 'live')),
  provider_subscription_id text not null check (provider_subscription_id ~ '^sub_[a-z0-9]+$'),
  provider_customer_id text not null check (provider_customer_id ~ '^ctm_[a-z0-9]+$'),
  status text not null check (status in ('active', 'past_due', 'paused', 'canceled')),
  plan text not null check (plan in ('base', 'team')),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  extra_venues integer not null check (extra_venues between 0 and 999),
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  scheduled_change_action text check (scheduled_change_action in ('cancel', 'pause', 'resume')),
  scheduled_change_at timestamptz,
  -- Primo rinnovo non riuscito: i tentativi successivi non riavviano i 7 giorni.
  past_due_since timestamptz,
  canceled_at timestamptz,
  paused_at timestamptz,
  last_event_id text not null,
  last_event_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (environment, provider_subscription_id),
  constraint billing_subscription_period check (
    (current_period_starts_at is null) = (current_period_ends_at is null)
    and (current_period_ends_at is null or current_period_ends_at > current_period_starts_at)
  ),
  constraint billing_subscription_schedule check (
    (scheduled_change_action is null) = (scheduled_change_at is null)
  )
);
alter table public.billing_subscriptions enable row level security;
-- Un solo abbonamento aperto per azienda: un secondo pagamento è un'anomalia
-- da rimborsare, non una capacità che si somma.
create unique index billing_subscriptions_open_uq
  on public.billing_subscriptions (workspace_id) where status <> 'canceled';
create trigger billing_subscriptions_updated_at
  before update on public.billing_subscriptions
  for each row execute function public.update_updated_at();
revoke all on public.billing_subscriptions from public, anon, authenticated;
grant select on public.billing_subscriptions to service_role;

-- 3. Richiesta di acquisto preparata dal server: lega l'abbonamento che nascerà
--    all'azienda giusta tramite custom_data, senza fidarsi del browser.
create table public.billing_checkouts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  environment text not null check (environment in ('sandbox', 'live')),
  -- Senza FK: la richiesta resta anche se l'account viene eliminato.
  requested_by uuid not null,
  plan text not null check (plan in ('base', 'team')),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  extra_venues integer not null check (extra_venues between 0 and 999),
  provider_transaction_id text unique check (provider_transaction_id ~ '^txn_[a-z0-9]+$'),
  status text not null default 'open' check (status in ('open', 'completed')),
  subscription_id uuid references public.billing_subscriptions (id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint billing_checkout_completion check (
    (status = 'completed') = (completed_at is not null and subscription_id is not null)
  )
);
alter table public.billing_checkouts enable row level security;
create index billing_checkouts_workspace_idx on public.billing_checkouts (workspace_id, created_at desc);
revoke all on public.billing_checkouts from public, anon, authenticated;
grant select on public.billing_checkouts to service_role;

-- 4. Registro degli eventi ricevuti: idempotenza (Paddle ritenta) e
--    riconciliazione. Anche gli eventi scartati restano, con il motivo.
create table private.billing_events (
  environment text not null check (environment in ('sandbox', 'live')),
  event_id text not null check (event_id ~ '^evt_[a-z0-9]+$'),
  event_type text not null,
  occurred_at timestamptz not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  outcome text not null check (outcome in ('applied', 'stale', 'ignored', 'rejected')),
  error text,
  subscription_id uuid references public.billing_subscriptions (id) on delete restrict,
  primary key (environment, event_id)
);
create index billing_events_subscription_idx on private.billing_events (subscription_id, occurred_at desc);
revoke all on private.billing_events from public, anon, authenticated;

-- 5. Periodi prodotti dagli abbonamenti, legati alla loro origine.
alter table public.workspace_access_periods
  drop constraint workspace_access_periods_kind_check;
alter table public.workspace_access_periods
  add constraint workspace_access_periods_kind_check check (kind in (
    'trial', 'complimentary_lifetime', 'complimentary_temporary', 'transition',
    'subscription', 'payment_grace'
  ));
alter table public.workspace_access_periods
  add column subscription_id uuid references public.billing_subscriptions (id) on delete restrict;
alter table public.workspace_access_periods
  add constraint workspace_access_periods_subscription_link check (
    (kind in ('subscription', 'payment_grace')) = (subscription_id is not null)
  );
-- Lo stesso evento ripetuto non duplica un periodo; la tolleranza nasce una
-- volta per periodo pagato, quindi i tentativi di pagamento non la allungano.
create unique index workspace_access_periods_subscription_uq
  on public.workspace_access_periods (subscription_id, kind, starts_at)
  where subscription_id is not null;


-- 6. Oracolo: copia integrale di 20261005000400_commercial_refresh.sql con un
--    solo cambio d'ordine. Un abbonamento attivo prevale su prova, transizione
--    e concessioni a tempo (chi compra durante la prova ottiene subito ciò che
--    ha comprato); la gratuità a vita resta la prima.
create or replace function private.workspace_access_at(p_workspace uuid, p_at timestamptz)
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
revoke all on function private.workspace_access_at(uuid, timestamptz)
  from public, anon, authenticated;


-- 7. Dallo stato dell'abbonamento ai periodi. `p_at` è l'istante dell'evento
--    Paddle, non quello di elaborazione: un evento ritentato tardi non sposta
--    i confini. Mai tagliare un periodo prima dell'evento che lo chiude.
create function private.billing_sync_periods(p_subscription uuid, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.billing_subscriptions;
  last_paid public.workspace_access_periods;
  last_end timestamptz;
  v_limit integer;
  v_start timestamptz;
  v_cut timestamptz;
  v_reason text;
begin
  select * into strict s from public.billing_subscriptions where id = p_subscription;
  v_limit := 1 + s.extra_venues;
  v_reason := format('Abbonamento Paddle %s (%s)', s.provider_subscription_id, s.environment);

  select * into last_paid from public.workspace_access_periods p
   where p.subscription_id = p_subscription and p.kind = 'subscription'
     and (p.revoked_at is null or p.revoked_at > p.starts_at)
   order by p.starts_at desc, p.created_at desc, p.id desc limit 1;
  if last_paid.id is not null then
    last_end := least(last_paid.ends_at, coalesce(last_paid.revoked_at, last_paid.ends_at));
  end if;

  if s.status = 'active' then
    if last_paid.id is null or s.current_period_starts_at >= last_end then
      -- Primo pagamento, rinnovo o ripresa: un nuovo periodo pagato.
      insert into public.workspace_access_periods (workspace_id, kind, plan, venue_limit,
        starts_at, ends_at, reason, subscription_id)
      values (s.workspace_id, 'subscription', s.plan, v_limit,
        s.current_period_starts_at, s.current_period_ends_at, v_reason, s.id)
      on conflict (subscription_id, kind, starts_at) where subscription_id is not null do nothing;
    elsif s.current_period_starts_at > last_paid.starts_at then
      -- Nuovo ciclo prima della fine del precedente (es. da mensile ad annuale).
      update public.workspace_access_periods set revoked_at = s.current_period_starts_at
       where id = last_paid.id;
      insert into public.workspace_access_periods (workspace_id, kind, plan, venue_limit,
        starts_at, ends_at, reason, subscription_id)
      values (s.workspace_id, 'subscription', s.plan, v_limit,
        s.current_period_starts_at, s.current_period_ends_at, v_reason, s.id)
      on conflict (subscription_id, kind, starts_at) where subscription_id is not null do nothing;
    elsif (last_paid.plan, last_paid.venue_limit, last_paid.ends_at)
          is distinct from (s.plan, v_limit, s.current_period_ends_at) then
      -- Stesso ciclo, capacità cambiata (upgrade pagato, sede aggiunta): vale
      -- dall'evento, e il tratto precedente resta nella storia.
      v_start := greatest(p_at, last_paid.starts_at);
      if v_start = last_paid.starts_at then
        update public.workspace_access_periods
           set plan = s.plan, venue_limit = v_limit, ends_at = s.current_period_ends_at
         where id = last_paid.id;
      elsif v_start < s.current_period_ends_at then
        update public.workspace_access_periods set revoked_at = v_start where id = last_paid.id;
        insert into public.workspace_access_periods (workspace_id, kind, plan, venue_limit,
          starts_at, ends_at, reason, subscription_id)
        values (s.workspace_id, 'subscription', s.plan, v_limit,
          v_start, s.current_period_ends_at, v_reason, s.id)
        on conflict (subscription_id, kind, starts_at) where subscription_id is not null do nothing;
      end if;
    end if;
    -- Pagamento recuperato: la tolleranza non serve più.
    update public.workspace_access_periods g
       set revoked_at = greatest(g.starts_at, p_at)
     where g.subscription_id = p_subscription and g.kind = 'payment_grace'
       and g.revoked_at is null and g.ends_at > p_at;

  elsif s.status = 'past_due' then
    -- Sette giorni dalla fine dell'ultimo periodo pagato, con la sua capacità.
    if last_paid.id is not null then
      insert into public.workspace_access_periods (workspace_id, kind, plan, venue_limit,
        starts_at, ends_at, reason, subscription_id)
      values (s.workspace_id, 'payment_grace', last_paid.plan, last_paid.venue_limit,
        last_end, last_end + interval '168 hours',
        'Tolleranza di 7 giorni per un rinnovo non riuscito', s.id)
      on conflict (subscription_id, kind, starts_at) where subscription_id is not null do nothing;
    end if;

  else
    -- Disdetta o pausa effettive: niente oltre l'evento. Una disdetta a fine
    -- periodo arriva alla fine, quindi il periodo pagato resta intero.
    v_cut := greatest(p_at, coalesce(case s.status when 'canceled' then s.canceled_at
      else s.paused_at end, p_at));
    update public.workspace_access_periods p
       set revoked_at = greatest(p.starts_at, v_cut)
     where p.subscription_id = p_subscription and p.revoked_at is null and p.ends_at > v_cut;
  end if;
end;
$$;
revoke all on function private.billing_sync_periods(uuid, timestamptz)
  from public, anon, authenticated;


-- 8. Ingresso unico degli eventi verificati. Ritorna l'esito senza sollevare
--    per i dati scartati (così Paddle non ritenta all'infinito e l'evento resta
--    nel registro); solleva solo per errori imprevisti, che Paddle ritenterà.
create function public.billing_apply_event(p_environment text, p_event jsonb)
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

  if v_type not like 'subscription.%' then
    -- Transazioni e rettifiche servono alla riconciliazione (M06/M09 successivi).
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
           count(*) filter (where bp.item in ('base', 'team')),
           max(bp.item) filter (where bp.item in ('base', 'team')),
           max((i ->> 'quantity')::integer) filter (where bp.item in ('base', 'team')),
           coalesce(sum((i ->> 'quantity')::integer) filter (where bp.item = 'extra_venue'), 0),
           count(distinct bp.billing_interval)
             filter (where bp.billing_interval is distinct from v_interval)
      into v_unknown, v_plan_items, v_plan, v_plan_quantity, v_extra, v_intervals
      from jsonb_array_elements(d -> 'items') i
      left join private.billing_prices bp
        on bp.environment = p_environment and bp.price_id = i #>> '{price,id}'
     where coalesce(i ->> 'status', 'active') <> 'inactive'
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
revoke all on function public.billing_apply_event(text, jsonb) from public, anon, authenticated;
grant execute on function public.billing_apply_event(text, jsonb) to service_role;


-- 9. Preparazione di un acquisto, chiamata dalla Edge Function per conto del
--    titolare (p_user viene dal JWT verificato lì). Restituisce i prezzi da
--    mettere nella transazione Paddle: il browser non li sceglie.
create function public.billing_prepare_checkout(
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
  if p_plan is null or p_plan not in ('base', 'team')
     or p_interval is null or p_interval not in ('month', 'year')
     or p_extra_venues is null or p_extra_venues not between 0 and 999 then
    raise exception 'billing_invalid_selection' using errcode = '22023';
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
  if p_plan = 'base' and (v_access #>> '{usage,people}')::bigint > 30 then
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
revoke all on function public.billing_prepare_checkout(text, uuid, uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.billing_prepare_checkout(text, uuid, uuid, text, text, integer)
  to service_role;

-- La transazione creata su Paddle per quella richiesta, per la riconciliazione.
create function public.billing_attach_checkout_transaction(p_checkout uuid, p_transaction_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_current text;
begin
  if p_transaction_id is null or p_transaction_id !~ '^txn_[a-z0-9]+$' then
    raise exception 'billing_invalid_transaction' using errcode = '22023';
  end if;
  select provider_transaction_id into v_current from public.billing_checkouts
   where id = p_checkout for update;
  if not found then
    raise exception 'billing_checkout_not_found' using errcode = 'P0002';
  end if;
  if v_current is not null and v_current <> p_transaction_id then
    raise exception 'billing_checkout_conflict' using errcode = '23514';
  end if;
  update public.billing_checkouts set provider_transaction_id = p_transaction_id
   where id = p_checkout;
end;
$$;
revoke all on function public.billing_attach_checkout_transaction(uuid, text)
  from public, anon, authenticated;
grant execute on function public.billing_attach_checkout_transaction(uuid, text) to service_role;


-- 10. Lettura per la pagina Piano: solo il titolare, solo dati dell'abbonamento
--     (niente importi o identificativi Paddle). null se non ne ha mai avuti.
create function public.get_workspace_billing(p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.billing_subscriptions;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.owns_workspace(p_workspace) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into s from public.billing_subscriptions
   where workspace_id = p_workspace
   order by (status <> 'canceled') desc, last_event_at desc limit 1;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'status', s.status,
    'plan', s.plan,
    'billing_interval', s.billing_interval,
    'extra_venues', s.extra_venues,
    'current_period_ends_at', s.current_period_ends_at,
    'scheduled_change', case when s.scheduled_change_action is null then null
      else jsonb_build_object('action', s.scheduled_change_action,
                              'effective_at', s.scheduled_change_at) end,
    'past_due_since', s.past_due_since,
    'canceled_at', s.canceled_at
  );
end;
$$;
revoke all on function public.get_workspace_billing(uuid) from public, anon, authenticated;
grant execute on function public.get_workspace_billing(uuid) to authenticated;
