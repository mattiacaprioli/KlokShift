-- Pagina Piano: il cambio programmato al rinnovo (billing_scheduled_changes)
-- si vede nella card Abbonamento, con il termine per annullarlo. Copia di
-- get_workspace_billing da 20261019000700_billing_pause.sql con `pending_change`
-- in più: il cambio aperto (in attesa o già inviato a Paddle) dell'abbonamento
-- mostrato, solo se quell'abbonamento non è chiuso. Niente identificativi o
-- articoli Paddle: l'importo è quello che il titolare ha visto e confermato.
create or replace function public.get_workspace_billing(p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.billing_subscriptions;
  c public.billing_scheduled_changes;
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
  if s.status <> 'canceled' then
    c := private.billing_open_scheduled_change(s.id);
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
    'canceled_at', s.canceled_at,
    'paused_at', s.paused_at,
    'pending_change', case when c.id is null then null
      else jsonb_build_object('plan', c.target_plan,
                              'billing_interval', c.target_interval,
                              'extra_venues', c.target_extra_venues,
                              'effective_at', c.effective_at,
                              'renewal_cents', c.renewal_cents,
                              'currency', c.currency,
                              'status', c.status,
                              -- Stessa finestra di billing_cancel_scheduled_change.
                              'cancel_until', c.effective_at - private.billing_schedule_window()) end
  );
end;
$$;
revoke all on function public.get_workspace_billing(uuid) from public, anon, authenticated;
grant execute on function public.get_workspace_billing(uuid) to authenticated;
