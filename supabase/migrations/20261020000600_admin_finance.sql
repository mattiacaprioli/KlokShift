-- Voce 5 / M06: incassi nell'area fondatore (docs/FOUNDER-DASHBOARD.md,
-- «Economia: ricavi, pagamenti e cassa»).
--
-- Solo dati verificati da Paddle, già nel registro degli avvisi firmati:
--   - MRR contrattuale: prezzi delle voci attive dell'ultimo avviso applicato di
--     ogni abbonamento `active` (annuale / 12), IVA esclusa; `past_due` a parte
--     come ricavo a rischio, `paused` e `canceled` a zero;
--   - pagamenti del mese: `transaction.completed` (lordo con IVA, IVA,
--     commissione Paddle, netto al venditore `earnings`), per origine;
--   - rimborsi del mese: rettifiche `refund` approvate, con il netto stornato.
-- Sandbox e live separati, valute separate, importi in centesimi; nessuna
-- somma fra ambienti. Payout e costi non sono collegati: restano `null`.
-- Un pagamento e il suo payout non si contano mai due volte: qui c'è solo il
-- lato cliente (vendita del MoR) e il netto che Paddle riconosce al venditore.

-- Centesimi da un campo testo di Paddle; null se non è un intero.
create function private.paddle_cents(p_value text)
returns bigint language sql immutable set search_path = '' as $$
  select case when p_value ~ '^-?[0-9]{1,15}$' then p_value::bigint end;
$$;

-- Valore ricorrente di un abbonamento, in centesimi IVA esclusa, dal suo ultimo avviso.
create function private.subscription_recurring_cents(p_subscription uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(private.paddle_cents(i #>> '{price,unit_price,amount}')
           * coalesce(nullif(i ->> 'quantity', '')::integer, 1)), 0)::bigint
    from public.billing_subscriptions s
    join private.billing_events e on e.environment = s.environment and e.event_id = s.last_event_id
    cross join lateral jsonb_array_elements(e.payload #> '{data,items}') i
   where s.id = p_subscription
     and coalesce(i ->> 'recurring', 'true') = 'true'
     and (coalesce(i ->> 'status', 'active') <> 'inactive' or s.status in ('paused', 'canceled'));
$$;

-- MRR di un abbonamento: solo se attivo. In sospeso è ricavo a rischio (a parte),
-- in pausa o disdetto è zero.
create function private.subscription_mrr_cents(p_subscription uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select case when s.status = 'active'
              then private.subscription_recurring_cents(s.id)::numeric
                   / case s.billing_interval when 'year' then 12 else 1 end
              else 0 end
    from public.billing_subscriptions s where s.id = p_subscription;
$$;

create function public.admin_get_finance(p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_month date;
  v_from timestamptz;
  v_to timestamptz;
  result jsonb;
begin
  perform private.require_platform_admin();
  v_month := date_trunc('month', coalesce(p_month, (now() at time zone 'Europe/Rome')::date))::date;
  if v_month < date '2026-01-01' or v_month > date '2100-01-01' then
    raise exception 'admin_invalid_filter' using errcode = '22023';
  end if;
  v_from := v_month::timestamp at time zone 'Europe/Rome';
  v_to := (v_month + interval '1 month')::timestamp at time zone 'Europe/Rome';

  with subs as materialized (
    select s.environment, s.status, s.scheduled_change_action,
           coalesce(e.payload #>> '{data,currency_code}', 'EUR') as currency,
           private.subscription_mrr_cents(s.id) as mrr,
           case when s.status = 'past_due'
                then private.subscription_recurring_cents(s.id)::numeric
                     / case s.billing_interval when 'year' then 12 else 1 end else 0 end as at_risk
      from public.billing_subscriptions s
      left join private.billing_events e on e.environment = s.environment and e.event_id = s.last_event_id),
  payments as materialized (
    select e.environment, coalesce(e.payload #>> '{data,currency_code}', 'EUR') as currency,
           e.payload #>> '{data,origin}' as origin,
           private.paddle_cents(e.payload #>> '{data,details,totals,grand_total}') as gross,
           private.paddle_cents(e.payload #>> '{data,details,totals,tax}') as tax,
           private.paddle_cents(e.payload #>> '{data,details,totals,fee}') as fee,
           private.paddle_cents(e.payload #>> '{data,details,totals,earnings}') as earnings
      from private.billing_events e
     where e.event_type = 'transaction.completed'
       and coalesce((e.payload #>> '{data,billed_at}')::timestamptz, e.occurred_at) >= v_from
       and coalesce((e.payload #>> '{data,billed_at}')::timestamptz, e.occurred_at) < v_to
       and coalesce(private.paddle_cents(e.payload #>> '{data,details,totals,grand_total}'), 0) > 0),
  refunds as materialized (
    select a.environment, coalesce(a.currency, 'EUR') as currency, a.total_cents as total,
           private.paddle_cents(e.payload #>> '{data,totals,earnings}') as earnings
      from private.billing_adjustments a
      left join private.billing_events e on e.environment = a.environment and e.event_id = a.last_event_id
     where a.action = 'refund' and a.status = 'approved'
       and a.last_event_at >= v_from and a.last_event_at < v_to),
  keys as (select environment, currency from subs union select environment, currency from payments
           union select environment, currency from refunds)
  select jsonb_build_object(
    'generated_at', now(), 'month', to_char(v_month, 'YYYY-MM'),
    'payouts', null, 'costs', null,
    'environments', (select coalesce(jsonb_agg(jsonb_build_object(
        'environment', k.environment, 'currency', k.currency,
        'mrr_cents', (select round(coalesce(sum(mrr), 0)) from subs s where s.environment = k.environment and s.currency = k.currency),
        'at_risk_mrr_cents', (select round(coalesce(sum(at_risk), 0)) from subs s where s.environment = k.environment and s.currency = k.currency),
        'subscriptions', jsonb_build_object(
          'active', (select count(*) from subs s where s.environment = k.environment and s.currency = k.currency and s.status = 'active'),
          'past_due', (select count(*) from subs s where s.environment = k.environment and s.currency = k.currency and s.status = 'past_due'),
          'paused', (select count(*) from subs s where s.environment = k.environment and s.currency = k.currency and s.status = 'paused'),
          'cancel_scheduled', (select count(*) from subs s where s.environment = k.environment and s.currency = k.currency
                                and s.status = 'active' and s.scheduled_change_action = 'cancel')),
        'payments', (select jsonb_build_object('count', count(*),
            'gross_cents', coalesce(sum(gross), 0), 'tax_cents', coalesce(sum(tax), 0),
            'fee_cents', coalesce(sum(fee), 0), 'earnings_cents', coalesce(sum(earnings), 0),
            'first_purchases', count(*) filter (where origin in ('api', 'web')),
            'renewals', count(*) filter (where origin = 'subscription_recurring'),
            'upgrades', count(*) filter (where origin = 'subscription_update'))
          from payments p where p.environment = k.environment and p.currency = k.currency),
        'refunds', (select jsonb_build_object('count', count(*), 'total_cents', coalesce(sum(total), 0),
            'earnings_cents', coalesce(sum(earnings), 0))
          from refunds r where r.environment = k.environment and r.currency = k.currency))
        order by k.environment = 'sandbox', k.currency), '[]'::jsonb) from keys k)
  ) into result;
  return result;
end;
$$;

-- Scheda azienda: abbonamenti, pagamenti e rimborsi di quell'azienda.
create function public.admin_get_workspace_finance(p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  if not exists (select 1 from public.workspaces where id = p_workspace) then
    raise exception 'admin_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'generated_at', now(),
    'subscriptions', (select coalesce(jsonb_agg(jsonb_build_object(
        'environment', s.environment, 'status', s.status, 'plan', s.plan, 'billing_interval', s.billing_interval,
        'extra_venues', s.extra_venues, 'current_period_ends_at', s.current_period_ends_at,
        'scheduled_change', s.scheduled_change_action, 'created_at', s.created_at,
        'currency', coalesce(e.payload #>> '{data,currency_code}', 'EUR'),
        'recurring_cents', private.subscription_recurring_cents(s.id),
        'mrr_cents', round(private.subscription_mrr_cents(s.id)))
        order by s.created_at desc), '[]'::jsonb)
      from public.billing_subscriptions s
      left join private.billing_events e on e.environment = s.environment and e.event_id = s.last_event_id
     where s.workspace_id = p_workspace),
    'payments', (select coalesce(jsonb_agg(x order by x ->> 'billed_at' desc), '[]'::jsonb) from (
      select jsonb_build_object('environment', e.environment,
          'billed_at', coalesce((e.payload #>> '{data,billed_at}')::timestamptz, e.occurred_at),
          'origin', e.payload #>> '{data,origin}', 'currency', e.payload #>> '{data,currency_code}',
          'gross_cents', private.paddle_cents(e.payload #>> '{data,details,totals,grand_total}'),
          'tax_cents', private.paddle_cents(e.payload #>> '{data,details,totals,tax}'),
          'fee_cents', private.paddle_cents(e.payload #>> '{data,details,totals,fee}'),
          'earnings_cents', private.paddle_cents(e.payload #>> '{data,details,totals,earnings}')) as x
        from private.billing_events e
        join public.billing_subscriptions s on s.environment = e.environment
         and s.provider_subscription_id = e.payload #>> '{data,subscription_id}'
       where s.workspace_id = p_workspace and e.event_type = 'transaction.completed'
         and coalesce(private.paddle_cents(e.payload #>> '{data,details,totals,grand_total}'), 0) > 0
       order by coalesce((e.payload #>> '{data,billed_at}')::timestamptz, e.occurred_at) desc limit 25) t),
    'refunds', (select coalesce(jsonb_agg(jsonb_build_object('environment', a.environment, 'status', a.status,
        'action', a.action, 'total_cents', a.total_cents, 'currency', a.currency, 'at', a.last_event_at,
        'effect', a.effect) order by a.last_event_at desc), '[]'::jsonb)
      from private.billing_adjustments a join public.billing_subscriptions s on s.id = a.subscription_id
     where s.workspace_id = p_workspace)
  );
end;
$$;

revoke all on function private.paddle_cents(text), private.subscription_recurring_cents(uuid),
  private.subscription_mrr_cents(uuid) from public, anon, authenticated;
revoke all on function public.admin_get_finance(date), public.admin_get_workspace_finance(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_get_finance(date), public.admin_get_workspace_finance(uuid) to authenticated;
