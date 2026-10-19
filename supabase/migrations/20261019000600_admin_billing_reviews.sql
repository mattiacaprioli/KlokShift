-- Area fondatore: rimborsi e contestazioni Paddle da verificare.
--
-- `private.billing_adjustments` (20261019000200) segna `manual_review` quello che
-- non si applica da solo: rimborso di un aumento o di una sede, contestazione,
-- rimborso di un pagamento non nel registro, rimborso annullato da Paddle. Anche
-- un rimborso totale che ha chiuso l'accesso chiede un'azione finché
-- l'abbonamento resta aperto su Paddle: Paddle non disdice quando rimborsa e al
-- rinnovo addebiterebbe di nuovo.
--
-- Il fondatore li vede nell'area amministrativa e li chiude con una nota. Stesse
-- regole delle altre RPC admin: allowlist, sessione viva e secondo fattore
-- rivalutati a ogni chiamata (private.require_platform_admin). Nessun importo
-- diventa incasso o rimborso nell'economia: è un registro di eventi verificati.

alter table private.billing_adjustments
  add column reviewed_at timestamptz,
  add column reviewed_by uuid,
  add column review_note text,
  add constraint billing_adjustment_review check (
    (reviewed_at is null) = (reviewed_by is null)
    and (reviewed_at is null) = (review_note is null)
    and (review_note is null or char_length(btrim(review_note)) between 3 and 500)
  );

-- Perché serve un'azione; null se non ne serve nessuna.
create function private.billing_adjustment_attention(a private.billing_adjustments,
  p_subscription_status text)
returns text language sql immutable set search_path = '' as $$
  select case
    when a.reviewed_at is not null then null
    when a.effect = 'access_cut' and p_subscription_status <> 'canceled' then 'cancel_on_paddle'
    when a.effect <> 'manual_review' or a.effect is null then null
    when a.status = 'reversed' then 'refund_reversed'
    when a.action in ('chargeback', 'chargeback_warning') then 'chargeback'
    when a.transaction_origin is null then 'unknown_payment'
    when a.transaction_origin = 'subscription_update' then 'upgrade_refunded'
    else 'other'
  end;
$$;

create function private.admin_billing_adjustment_json(a private.billing_adjustments)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'environment', a.environment, 'adjustment_id', a.provider_adjustment_id,
    'workspace_id', b.workspace_id, 'workspace_name', w.name,
    'subscription_id', b.provider_subscription_id, 'subscription_status', b.status,
    'transaction_id', a.provider_transaction_id, 'transaction_origin', a.transaction_origin,
    'action', a.action, 'adjustment_type', a.adjustment_type, 'status', a.status,
    'total_cents', a.total_cents, 'currency', a.currency,
    'covered_starts_at', a.covered_starts_at, 'covered_ends_at', a.covered_ends_at,
    'effect', a.effect, 'access_cut_at', a.access_cut_at,
    'created_at', a.created_at, 'last_event_at', a.last_event_at,
    'reviewed_at', a.reviewed_at, 'review_note', a.review_note,
    'attention', private.billing_adjustment_attention(a, b.status))
  from public.billing_subscriptions b
  join public.workspaces w on w.id = b.workspace_id
  where b.id = a.subscription_id;
$$;

-- Elenco: da verificare (predefinito) o tutto lo storico; anche per una sola azienda.
create function public.admin_list_billing_adjustments(p_workspace uuid default null,
  p_open_only boolean default true, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.require_platform_admin();
  perform private.validate_admin_page('', 25, p_offset);
  if p_open_only is null then raise exception 'admin_invalid_filter' using errcode = '22023'; end if;
  with rows as materialized (
    select a, private.billing_adjustment_attention(a, b.status) as attention
      from private.billing_adjustments a
      join public.billing_subscriptions b on b.id = a.subscription_id
     where p_workspace is null or b.workspace_id = p_workspace)
  select jsonb_build_object('generated_at', now(),
    'open_total', (select count(*) from rows where attention is not null),
    'total', (select count(*) from rows where not p_open_only or attention is not null),
    'limit', 25, 'offset', p_offset,
    'items', (select coalesce(jsonb_agg(private.admin_billing_adjustment_json(r.a) order by (r.a).created_at desc), '[]'::jsonb)
      from (select * from rows where not p_open_only or attention is not null
             order by (a).created_at desc, (a).provider_adjustment_id
             limit 25 offset p_offset) r))
  into result;
  return result;
end;
$$;

-- Chiusura con nota: chi, quando e perché. Solo per una voce che chiede ancora un'azione.
create function public.admin_resolve_billing_adjustment(p_environment text, p_adjustment text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a private.billing_adjustments;
  v_status text;
begin
  perform private.require_platform_admin();
  if p_note is null or char_length(btrim(p_note)) not between 3 and 500 then
    raise exception 'admin_review_note_required' using errcode = '22023';
  end if;
  select * into a from private.billing_adjustments
   where environment = p_environment and provider_adjustment_id = p_adjustment for update;
  if not found then raise exception 'admin_not_found' using errcode = 'P0002'; end if;
  select status into v_status from public.billing_subscriptions where id = a.subscription_id;
  if private.billing_adjustment_attention(a, v_status) is null then
    raise exception 'admin_review_not_open' using errcode = '22023';
  end if;
  update private.billing_adjustments
     set reviewed_at = now(), reviewed_by = (select auth.uid()), review_note = btrim(p_note), updated_at = now()
   where environment = p_environment and provider_adjustment_id = p_adjustment
  returning * into a;
  return private.admin_billing_adjustment_json(a);
end;
$$;

revoke all on function private.billing_adjustment_attention(private.billing_adjustments, text),
  private.admin_billing_adjustment_json(private.billing_adjustments) from public, anon, authenticated;
revoke all on function public.admin_list_billing_adjustments(uuid, boolean, integer),
  public.admin_resolve_billing_adjustment(text, text, text) from public, anon, authenticated;
grant execute on function public.admin_list_billing_adjustments(uuid, boolean, integer),
  public.admin_resolve_billing_adjustment(text, text, text) to authenticated;
