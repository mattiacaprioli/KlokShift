-- Cambio piano al rinnovo, primo blocco: la richiesta (design
-- docs/superpowers/specs/2026-10-31-cambio-piano-al-rinnovo-design.md §7.1, §8.1, §8.2).
--
-- Riduzioni (Team→Base, meno sedi) e cambio mensile↔annuale non si applicano
-- più a mano: il titolare li programma per il prossimo rinnovo dalla pagina
-- Piano. Qui nascono solo la riga e le sue regole; a Paddle non parte niente.
-- L'invio lo farà un lavoro pianificato nelle 24 ore prima del rinnovo, e il
-- diritto continua ad arrivare soltanto dagli avvisi firmati.
--
-- Le righe non si cancellano: sono storia commerciale, come gli abbonamenti.

-- Finestra d'invio: da qui al rinnovo il cambio è del lavoro pianificato, non
-- più del titolare. Un solo valore per richiesta, annullamento e invio.
create function private.billing_schedule_window()
returns interval language sql immutable set search_path = '' as $$
  select interval '24 hours'
$$;
revoke all on function private.billing_schedule_window() from public, anon, authenticated;

create table public.billing_scheduled_changes (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.billing_subscriptions (id) on delete restrict,
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  environment text not null check (environment in ('sandbox', 'live')),
  -- Il punto d'arrivo, non la differenza: un solo cambio descrive tutto.
  target_plan text not null check (target_plan in ('base', 'team')),
  target_interval text not null check (target_interval in ('month', 'year')),
  target_extra_venues integer not null check (target_extra_venues between 0 and 999),
  -- Il ciclo alla richiesta: un cambio di ciclo vuole anche la PATCH della
  -- data del rinnovo, e solo lui (20261101000300, Edge Function `billing-scheduled`).
  from_interval text not null check (from_interval in ('month', 'year')),
  -- Articoli `{price_id, quantity}` alla richiesta e d'arrivo (quelli
  -- dell'anteprima): all'invio si confronta con Paddle, non si ricalcola.
  from_items jsonb not null check (jsonb_typeof(from_items) = 'array' and jsonb_array_length(from_items) > 0),
  target_items jsonb not null check (jsonb_typeof(target_items) = 'array' and jsonb_array_length(target_items) > 0),
  -- L'importo del rinnovo mostrato al titolare, per riconoscerlo all'avviso.
  renewal_cents bigint not null check (renewal_cents >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  effective_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'applied', 'confirmed', 'canceled', 'failed')),
  -- `date_not_fixed`: cambio di ciclo con gli articoli su Paddle e la data del
  -- rinnovo che non si può più rimettere; `renewal_overdue`: nessun avviso del
  -- rinnovo due ore dopo la data d'effetto (20261101000300).
  close_reason text check (close_reason in ('owner', 'paused', 'canceled', 'past_due',
    'rules_changed', 'paddle_mismatch', 'paddle_error', 'renewal_mismatch', 'date_not_fixed',
    'renewal_overdue')),
  -- Senza FK, come billing_checkouts: la storia resta anche senza l'account.
  requested_by uuid not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid,
  -- Invio a Paddle.
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  applied_at timestamptz,
  confirmed_at timestamptz,
  -- Promemoria al titolare.
  reminder_notified_at timestamptz,
  reminder_emailed_at timestamptz,
  reminder_email_attempts integer not null default 0 check (reminder_email_attempts between 0 and 5),
  -- Allarme al fondatore e sua revisione. `date_not_fixed`: cambio di ciclo
  -- con gli articoli su Paddle ma la data del rinnovo non rimessa;
  -- `renewal_overdue`: Paddle non ha rinnovato alla data del cambio (20261101000300).
  alert_kind text check (alert_kind in ('not_sent', 'failed', 'renewal_mismatch', 'date_not_fixed',
    'renewal_overdue')),
  alert_emailed_at timestamptz,
  alert_email_attempts integer not null default 0 check (alert_email_attempts between 0 and 5),
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_note text,
  -- Una riga chiusa dice sempre perché e quando; una aperta non ha motivo.
  constraint billing_scheduled_change_closed check (
    (status in ('canceled', 'failed')) = (close_reason is not null)
    and (close_reason is null) = (closed_at is null)
  )
);
alter table public.billing_scheduled_changes enable row level security;
-- Un solo cambio aperto per abbonamento: un secondo si chiede dopo aver
-- annullato il primo.
create unique index billing_scheduled_changes_open_uq
  on public.billing_scheduled_changes (subscription_id) where status in ('pending', 'applied');
-- Sul progetto ospitato i privilegi di default danno tutto alla service role:
-- si toglie anche a lei e si ridà solo ciò che serve.
revoke all on public.billing_scheduled_changes from public, anon, authenticated, service_role;
-- Le righe nascono solo dalla RPC; il servizio le legge e ne aggiorna lo stato.
grant select, update on public.billing_scheduled_changes to service_role;

-- Il cambio aperto dell'abbonamento (in attesa o già inviato), o null.
create function private.billing_open_scheduled_change(p_subscription uuid)
returns public.billing_scheduled_changes language sql stable security definer set search_path = '' as $$
  select * from public.billing_scheduled_changes
   where subscription_id = p_subscription and status in ('pending', 'applied')
$$;
revoke all on function private.billing_open_scheduled_change(uuid) from public, anon, authenticated;

-- Le regole del punto d'arrivo: null se ammesso, altrimenti il codice. Non
-- guarda né la finestra d'invio né la riga aperta, perché il lavoro d'invio
-- la richiama dentro la finestra sulla propria riga per ricontrollare.
create function private.billing_scheduled_rules_error(p_subscription uuid, p_plan text,
  p_interval text, p_extra integer)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  s public.billing_subscriptions;
  v_usage jsonb;
begin
  if p_plan is null or p_plan not in ('base', 'team')
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
  if (p_plan = 'team' and s.plan = 'base') or p_extra > s.extra_venues then
    return 'billing_scheduled_not_reduction';
  end if;
  if p_plan = s.plan and p_interval = s.billing_interval and p_extra = s.extra_venues then
    return 'billing_no_change';
  end if;
  -- La capacità futura deve già bastare: si riduce dopo aver chiuso, mai prima.
  -- 30 è il limite di Base in private.workspace_access_at.
  v_usage := private.workspace_access_at(s.workspace_id, now()) -> 'usage';
  if p_plan = 'base' and (v_usage ->> 'people')::integer > 30 then
    return 'billing_scheduled_people';
  end if;
  if (v_usage ->> 'venues')::integer > 1 + p_extra then
    return 'billing_scheduled_venues';
  end if;
  return null;
end;
$$;
revoke all on function private.billing_scheduled_rules_error(uuid, text, text, integer)
  from public, anon, authenticated;

-- Anteprima: le regole più la riga aperta e la finestra d'invio. Restituisce i
-- prezzi d'arrivo da proporre; gli articoli invariati li tiene la Edge Function
-- dal dato di Paddle, come per gli aumenti.
create function public.billing_prepare_scheduled_change(
  p_environment text, p_user uuid, p_workspace uuid, p_plan text, p_interval text, p_extra_venues integer
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.billing_subscriptions;
  v_error text;
  v_plan_price text;
  v_extra_price text;
begin
  if p_plan is null or p_plan not in ('base', 'team')
     or p_interval is null or p_interval not in ('month', 'year')
     or p_extra_venues is null or p_extra_venues not between 0 and 999 then
    raise exception 'billing_invalid_selection' using errcode = '22023';
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
revoke all on function public.billing_prepare_scheduled_change(text, uuid, uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.billing_prepare_scheduled_change(text, uuid, uuid, text, text, integer)
  to service_role;

-- Registrazione: rifà l'anteprima sotto il lock commerciale (persone e sedi non
-- cambiano nel frattempo) e salva la riga con gli articoli mostrati. Gli
-- articoli li compone la Edge Function, ma l'invio li userà così come sono:
-- devono descrivere esattamente il punto d'arrivo.
create function public.billing_record_scheduled_change(
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
         count(*) filter (where bp.item in ('base', 'team')),
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
revoke all on function public.billing_record_scheduled_change(text, uuid, uuid, text, text, integer,
  jsonb, jsonb, bigint, text) from public, anon, authenticated;
grant execute on function public.billing_record_scheduled_change(text, uuid, uuid, text, text, integer,
  jsonb, jsonb, bigint, text) to service_role;

-- Annullamento del titolare, solo prima della finestra d'invio: dopo, il cambio
-- è del lavoro pianificato o già su Paddle. Pausa e disdetta restano possibili
-- e lo chiudono da sé.
create function public.billing_cancel_scheduled_change(p_environment text, p_user uuid, p_workspace uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.billing_subscriptions;
  c public.billing_scheduled_changes;
begin
  s := private.billing_owner_subscription(p_environment, p_user, p_workspace);
  select * into c from public.billing_scheduled_changes
   where subscription_id = s.id and status in ('pending', 'applied')
   for update;
  if not found then
    raise exception 'billing_nothing_scheduled' using errcode = 'P0002';
  end if;
  if c.status = 'applied' or now() >= c.effective_at - private.billing_schedule_window() then
    raise exception 'billing_change_already_sent' using errcode = '23514';
  end if;
  update public.billing_scheduled_changes
     set status = 'canceled', close_reason = 'owner', closed_at = now(), closed_by = p_user
   where id = c.id;
end;
$$;
revoke all on function public.billing_cancel_scheduled_change(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.billing_cancel_scheduled_change(text, uuid, uuid) to service_role;

-- Copia di billing_prepare_change da 20261019000000_billing_manage.sql con il
-- blocco del cambio aperto: un aumento sopra una riduzione programmata
-- confonderebbe il punto d'arrivo, quindi prima si annulla. Stessa firma: i
-- privilegi restano.
create or replace function public.billing_prepare_change(
  p_environment text, p_user uuid, p_workspace uuid, p_plan text, p_extra_venues integer
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.billing_subscriptions;
  v_plan_price text;
  v_extra_price text;
begin
  if p_plan is null or p_plan not in ('base', 'team')
     or p_extra_venues is null or p_extra_venues not between 0 and 999 then
    raise exception 'billing_invalid_selection' using errcode = '22023';
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
  if (s.plan = 'team' and p_plan = 'base') or p_extra_venues < s.extra_venues then
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
