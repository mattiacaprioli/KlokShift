-- M11: uscita dalla pagina Piano con il riepilogo (MONETIZATION §4, §8).
--
-- «Ferma i rinnovi» apriva la disdetta del portale Paddle senza dire cosa
-- succede dopo. Ora la pagina mostra prima la conferma (ultimo giorno pagato,
-- scadenza dell'archivio, cosa si cancella, alternativa della pausa) e la
-- disdetta a fine periodo passa da `billing-manage` (`cancel`, Paddle
-- `next_billing_period`), con le stesse verifiche della pausa: abbonamento
-- attivo, nessun cambio già programmato. Annullarla resta «Riprendi i rinnovi».
--
-- Copia di billing_prepare_lifecycle da 20261019000700_billing_pause.sql con
-- l'azione `cancel` in più. Stessa firma: i privilegi restano.

create or replace function public.billing_prepare_lifecycle(p_environment text, p_user uuid,
  p_workspace uuid, p_action text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.billing_subscriptions;
begin
  if p_action is null or p_action not in ('pause', 'resume', 'cancel') then
    raise exception 'billing_invalid_selection' using errcode = '22023';
  end if;
  s := private.billing_owner_subscription(p_environment, p_user, p_workspace);
  if p_action in ('pause', 'cancel') then
    if s.status = 'past_due' then
      raise exception 'billing_past_due' using errcode = '23514';
    elsif s.status = 'paused' then
      raise exception 'billing_paused' using errcode = '23514';
    elsif s.scheduled_change_action is not null then
      raise exception 'billing_change_scheduled' using errcode = '23514';
    end if;
  else
    if s.status <> 'paused' then
      raise exception 'billing_not_paused' using errcode = '23514';
    end if;
    -- Una gratuità a vita operativa non richiede di pagare per lavorare.
    if private.workspace_access_at(p_workspace, now()) ->> 'source' = 'complimentary_lifetime'
       and private.workspace_access_at(p_workspace, now()) ->> 'state' = 'operational' then
      raise exception 'billing_not_needed' using errcode = '23514';
    end if;
  end if;
  return jsonb_build_object('subscription_id', s.provider_subscription_id);
end;
$$;

