-- M09d: gestione dell'abbonamento dalla pagina Piano (portale Paddle, ripresa
-- dei rinnovi, aumenti di piano o sedi). Due porte solo service role, chiamate
-- dalla Edge Function `billing-manage` per conto dell'utente verificato dal JWT,
-- come `billing_prepare_checkout`. Nessuna concede capacità: il diritto arriva
-- sempre e solo dagli avvisi firmati (`billing_apply_event`).
--
-- Riduzioni (Team→Base, meno sedi) e cambio mensile↔annuale restano assistiti
-- per ora (decisione del 18/10): Paddle applica i cambi subito, la regola vuole
-- le riduzioni al rinnovo.

-- Titolare attivo e abbonamento aperto in quell'ambiente; altrimenti un errore.
create function private.billing_owner_subscription(p_environment text, p_user uuid, p_workspace uuid)
returns public.billing_subscriptions language plpgsql stable security definer set search_path = '' as $$
declare s public.billing_subscriptions;
begin
  if p_environment is null or p_environment not in ('sandbox', 'live') then
    raise exception 'billing_invalid_environment' using errcode = '22023';
  end if;
  if p_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.workspace_members m
      join public.workspaces w on w.id = m.workspace_id and w.deleted_at is null
     where m.workspace_id = p_workspace and m.user_id = p_user
       and m.authority = 'owner' and m.status = 'active') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into s from public.billing_subscriptions
   where workspace_id = p_workspace and environment = p_environment and status <> 'canceled';
  if not found then
    raise exception 'billing_no_subscription' using errcode = 'P0002';
  end if;
  return s;
end;
$$;
revoke all on function private.billing_owner_subscription(text, uuid, uuid) from public, anon, authenticated;

-- Contesto per il portale e per «Riprendi i rinnovi».
create function public.billing_manage_context(p_environment text, p_user uuid, p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.billing_subscriptions;
begin
  s := private.billing_owner_subscription(p_environment, p_user, p_workspace);
  return jsonb_build_object(
    'subscription_id', s.provider_subscription_id,
    'customer_id', s.provider_customer_id,
    'status', s.status,
    'plan', s.plan,
    'billing_interval', s.billing_interval,
    'extra_venues', s.extra_venues,
    'scheduled_change', s.scheduled_change_action
  );
end;
$$;
revoke all on function public.billing_manage_context(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.billing_manage_context(text, uuid, uuid) to service_role;

-- Un aumento: piano non inferiore, sedi non meno, almeno uno dei due di più.
-- Restituisce i prezzi da proporre per il ciclo attuale; gli articoli invariati
-- li tiene la Edge Function dal dato di Paddle, così nessuno cambia listino.
create function public.billing_prepare_change(
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
revoke all on function public.billing_prepare_change(text, uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.billing_prepare_change(text, uuid, uuid, text, integer) to service_role;
