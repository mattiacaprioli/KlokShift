-- Cambio piano al rinnovo, secondo blocco: gli avvisi di Paddle chiudono o
-- confermano il cambio aperto (design
-- docs/superpowers/specs/2026-10-31-cambio-piano-al-rinnovo-design.md §7.4 bis,
-- §8.3, §8.4).
--
-- Un trigger sull'abbonamento, non una modifica a billing_apply_event: ogni
-- avviso applicato aggiorna la riga dell'abbonamento, e qui si guarda solo il
-- suo stato nuovo. Gira dentro il lock commerciale dell'avviso.

create function private.billing_scheduled_reconcile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.billing_scheduled_changes;
begin
  select * into c from public.billing_scheduled_changes
   where subscription_id = new.id and status in ('pending', 'applied')
   for update;
  if not found then
    return null;
  end if;

  if c.status = 'pending'
     and (new.scheduled_change_action is not null or new.status <> 'active') then
    -- Pausa, disdetta o rinnovo non riuscito prima dell'invio: il cambio non
    -- parte. Lo stato vince sull'azione programmata; una ripresa programmata
    -- vuol dire che l'abbonamento è in pausa.
    update public.billing_scheduled_changes
       set status = 'canceled', closed_at = now(),
           close_reason = case
             when new.status <> 'active' then new.status
             when new.scheduled_change_action = 'cancel' then 'canceled'
             else 'paused'
           end
     where id = c.id;
  elsif c.status = 'applied' and new.status in ('paused', 'canceled') then
    -- Già su Paddle: chiude solo una pausa o disdetta avvenuta. Una solo
    -- programmata lascia il cambio com'è, perché se il titolare la annulla il
    -- rinnovo avviene col piano nuovo, come chiesto. Un rinnovo in sospeso
    -- aspetta il recupero.
    update public.billing_scheduled_changes
       set status = 'canceled', close_reason = new.status, closed_at = now()
     where id = c.id;
  elsif new.status = 'active'
        and new.current_period_starts_at >= c.effective_at - interval '5 minutes' then
    -- Il rinnovo: confermato se è arrivato il punto d'arrivo, altrimenti da
    -- verificare dal fondatore. Vale anche per un cambio mai inviato: rinnovare
    -- al prezzo vecchio senza che nessuno se ne accorga è proprio ciò che
    -- l'allarme deve impedire. Se invece il punto d'arrivo c'è già (cambiato a
    -- mano su Paddle), si conferma e il fondatore non riceve un allarme a vuoto.
    if new.plan = c.target_plan and new.billing_interval = c.target_interval
       and new.extra_venues = c.target_extra_venues then
      update public.billing_scheduled_changes
         set status = 'confirmed', confirmed_at = now()
       where id = c.id;
    else
      update public.billing_scheduled_changes
         set status = 'failed', close_reason = 'renewal_mismatch', closed_at = now(),
             alert_kind = 'renewal_mismatch'
       where id = c.id;
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.billing_scheduled_reconcile() from public, anon, authenticated;

create trigger billing_subscriptions_scheduled_reconcile
  after update on public.billing_subscriptions
  for each row execute function private.billing_scheduled_reconcile();
