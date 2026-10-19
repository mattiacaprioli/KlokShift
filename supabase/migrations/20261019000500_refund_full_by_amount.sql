-- Rimborso «totale» secondo l'importo, non secondo l'etichetta di Paddle.
--
-- Prova sandbox D del 19/10: il rimborso di tutto il rinnovo (96,38 € su
-- 96,38 €) fatto dalla dashboard Paddle, riga per riga, arriva con
-- `type: partial` e ogni riga `full`. Con la regola di 20261019000200 sarebbe
-- stato solo registrato, senza chiudere l'accesso. Ora è totale se `type` è
-- `full` oppure se l'importo rimborsato copre l'intero pagato
-- (`details.totals.grand_total` del suo `transaction.completed`). Le righe
-- `full` da sole non bastano: rimborsare per intero una sola riga (la sede
-- aggiuntiva) non è il rimborso del periodo.
--
-- La chiusura dei periodi passa in una funzione comune, usata anche per
-- riparare i rimborsi approvati e registrati come parziali prima di questa
-- correzione. billing_apply_adjustment: copia di 20261019000200 §4.

create function private.billing_adjustment_is_full(d jsonb, txn jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(d ->> 'type', 'partial') = 'full'
    or coalesce(d #>> '{totals,total}' ~ '^[0-9]{1,15}$'
       and txn #>> '{details,totals,grand_total}' ~ '^[0-9]{1,15}$'
       and (txn #>> '{details,totals,grand_total}')::bigint > 0
       and (d #>> '{totals,total}')::bigint >= (txn #>> '{details,totals,grand_total}')::bigint, false);
$$;
revoke all on function private.billing_adjustment_is_full(jsonb, jsonb) from public, anon, authenticated;

-- Dall'approvazione (mai prima dell'inizio del periodo pagato): il tratto già
-- goduto resta nella storia, quello rimborsato non si usa più.
create function private.billing_refund_cut(p_subscription uuid, p_start timestamptz,
  p_end timestamptz, p_at timestamptz)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_cut timestamptz := greatest(p_at, p_start);
begin
  update public.workspace_access_periods p
     set revoked_at = greatest(p.starts_at, v_cut)
   where p.subscription_id = p_subscription
     and (p.starts_at < p_end or (p.kind = 'payment_grace' and p.starts_at = p_end))
     and coalesce(least(p.ends_at, p.revoked_at), p.ends_at) > v_cut;
  update public.billing_subscriptions
     set refunded_until = greatest(coalesce(refunded_until, p_end), p_end)
   where id = p_subscription;
  return v_cut;
end;
$$;
revoke all on function private.billing_refund_cut(uuid, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;

create or replace function private.billing_apply_adjustment(p_environment text, p_event_id text,
  p_type text, p_occurred timestamptz, p_event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d jsonb := p_event -> 'data';
  v_error text;
  s public.billing_subscriptions;
  a private.billing_adjustments;
  v_found boolean;
  v_txn jsonb;
  v_type text := coalesce(d ->> 'type', 'partial');
  v_effect text;
  v_start timestamptz;
  v_end timestamptz;
  v_cut_at timestamptz;
begin
  if d ->> 'id' is null or d ->> 'id' !~ '^adj_[a-z0-9]+$'
     or d ->> 'transaction_id' is null or d ->> 'transaction_id' !~ '^txn_[a-z0-9]+$'
     or d ->> 'action' is null or v_type not in ('full', 'partial')
     or d ->> 'status' is null
     or d ->> 'status' not in ('pending_approval', 'approved', 'rejected', 'reversed') then
    v_error := 'invalid_adjustment';
  else
    select * into s from public.billing_subscriptions
     where environment = p_environment and provider_subscription_id = d ->> 'subscription_id';
    if not found then
      v_error := 'unknown_subscription';
    end if;
  end if;
  if v_error is not null then
    insert into private.billing_events (environment, event_id, event_type, occurred_at,
      payload, outcome, error, subscription_id)
    values (p_environment, p_event_id, p_type, p_occurred, p_event, 'rejected', v_error, s.id);
    return jsonb_build_object('outcome', 'rejected', 'error', v_error);
  end if;

  perform private.lock_commercial_workspace(s.workspace_id);
  select * into s from public.billing_subscriptions where id = s.id for update;
  select * into a from private.billing_adjustments
   where environment = p_environment and provider_adjustment_id = d ->> 'id' for update;
  v_found := found;
  -- Fuori ordine: un avviso più vecchio dell'ultimo non riporta indietro lo stato.
  if v_found and p_occurred < a.last_event_at then
    insert into private.billing_events (environment, event_id, event_type, occurred_at,
      payload, outcome, subscription_id)
    values (p_environment, p_event_id, p_type, p_occurred, p_event, 'stale', s.id);
    return jsonb_build_object('outcome', 'stale', 'subscription_id', s.id);
  end if;

  select e.payload -> 'data' into v_txn from private.billing_events e
   where e.environment = p_environment and e.event_type = 'transaction.completed'
     and e.payload #>> '{data,id}' = d ->> 'transaction_id'
   order by e.occurred_at desc limit 1;
  if v_txn is not null and v_txn ->> 'subscription_id' is distinct from d ->> 'subscription_id' then
    v_txn := null;  -- Pagamento di un altro abbonamento: non si usa il suo periodo.
  end if;
  v_start := (v_txn #>> '{billing_period,starts_at}')::timestamptz;
  v_end := (v_txn #>> '{billing_period,ends_at}')::timestamptz;

  v_effect := a.effect;
  v_cut_at := a.access_cut_at;
  if v_effect is null and d ->> 'status' = 'approved' then
    v_effect := case
      when d ->> 'action' = 'refund' and private.billing_adjustment_is_full(d, v_txn)
           and v_txn ->> 'origin' in ('api', 'web', 'subscription_recurring')
           and v_start is not null and v_end > v_start then 'access_cut'
      -- Parziale: credito per disservizio o cortesia, l'accesso pagato resta.
      when d ->> 'action' = 'refund' and v_txn is not null
           and not private.billing_adjustment_is_full(d, v_txn) then 'none'
      when d ->> 'action' in ('refund', 'chargeback', 'chargeback_warning') then 'manual_review'
      else 'none'
    end;
    if v_effect = 'access_cut' then
      -- Dall'approvazione (mai prima dell'inizio del periodo pagato): il tratto
      -- già goduto resta nella storia, quello rimborsato non si usa più.
      v_cut_at := private.billing_refund_cut(s.id, v_start, v_end, p_occurred);
    end if;
  elsif v_effect = 'access_cut' and d ->> 'status' = 'reversed' then
    -- Rimborso annullato da Paddle: l'accesso non torna da solo, lo decide il fondatore.
    v_effect := 'manual_review';
  end if;

  insert into private.billing_adjustments (environment, provider_adjustment_id, subscription_id,
    provider_transaction_id, action, adjustment_type, status, total_cents, currency,
    transaction_origin, covered_starts_at, covered_ends_at, effect, access_cut_at,
    last_event_id, last_event_at)
  values (p_environment, d ->> 'id', s.id, d ->> 'transaction_id', d ->> 'action', v_type,
    d ->> 'status',
    case when d #>> '{totals,total}' ~ '^-?[0-9]{1,15}$' then (d #>> '{totals,total}')::bigint end,
    coalesce(d #>> '{totals,currency_code}', d ->> 'currency_code'),
    v_txn ->> 'origin', v_start, v_end, v_effect, v_cut_at, p_event_id, p_occurred)
  on conflict (environment, provider_adjustment_id) do update set
    status = excluded.status,
    adjustment_type = excluded.adjustment_type,
    total_cents = coalesce(excluded.total_cents, billing_adjustments.total_cents),
    currency = coalesce(excluded.currency, billing_adjustments.currency),
    transaction_origin = excluded.transaction_origin,
    covered_starts_at = excluded.covered_starts_at,
    covered_ends_at = excluded.covered_ends_at,
    effect = excluded.effect,
    access_cut_at = excluded.access_cut_at,
    last_event_id = excluded.last_event_id,
    last_event_at = excluded.last_event_at,
    updated_at = now();

  insert into private.billing_events (environment, event_id, event_type, occurred_at,
    payload, outcome, subscription_id)
  values (p_environment, p_event_id, p_type, p_occurred, p_event, 'applied', s.id);
  return jsonb_build_object('outcome', 'applied', 'subscription_id', s.id,
    'workspace_id', s.workspace_id, 'effect', v_effect);
end;
$$;
revoke all on function private.billing_apply_adjustment(text, text, text, timestamptz, jsonb)
  from public, anon, authenticated;


-- Rimborsi approvati e registrati come parziali prima di questa correzione.
do $$
declare
  r record;
  d jsonb;
  v_txn jsonb;
begin
  for r in
    select a.*, b.workspace_id from private.billing_adjustments a
      join public.billing_subscriptions b on b.id = a.subscription_id
     where a.action = 'refund' and a.status = 'approved' and a.effect = 'none'
       and a.transaction_origin in ('api', 'web', 'subscription_recurring')
       and a.covered_starts_at is not null and a.covered_ends_at > a.covered_starts_at
  loop
    select e.payload -> 'data' into d from private.billing_events e
     where e.environment = r.environment and e.event_id = r.last_event_id;
    select e.payload -> 'data' into v_txn from private.billing_events e
     where e.environment = r.environment and e.event_type = 'transaction.completed'
       and e.payload #>> '{data,id}' = r.provider_transaction_id
     order by e.occurred_at desc limit 1;
    if private.billing_adjustment_is_full(d, v_txn) then
      perform private.lock_commercial_workspace(r.workspace_id);
      update private.billing_adjustments set effect = 'access_cut',
        access_cut_at = private.billing_refund_cut(r.subscription_id, r.covered_starts_at,
          r.covered_ends_at, r.last_event_at),
        updated_at = now()
       where environment = r.environment and provider_adjustment_id = r.provider_adjustment_id;
    end if;
  end loop;
end $$;
