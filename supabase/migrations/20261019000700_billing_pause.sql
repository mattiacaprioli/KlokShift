-- M11: pausa e ripartenza dell'abbonamento dalla pagina Piano.
--
-- Regola (docs/MONETIZATION.md §4): la pausa ferma i rinnovi alla fine del
-- periodo già pagato, piano e sedi extra insieme; fino ad allora si lavora,
-- poi consultazione ed export per 12 mesi. La ripartenza è un'azione esplicita
-- del titolare: Paddle apre un periodo nuovo da quel momento e addebita subito,
-- senza nuova prova. Annuale: la pausa non congela né prolunga i dodici mesi,
-- ferma solo il rinnovo. Annullare una pausa programmata passa da
-- «Riprendi i rinnovi» (`scheduled_change: null`), già in billing-manage.
--
-- Come per gli aumenti la Edge Function chiede qui se l'azione è ammessa e il
-- diritto arriva solo dagli avvisi firmati: `paused` chiude i periodi dalla
-- pausa (billing_sync_periods), il ritorno `active` apre il periodo nuovo.

create function public.billing_prepare_lifecycle(p_environment text, p_user uuid,
  p_workspace uuid, p_action text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.billing_subscriptions;
begin
  if p_action is null or p_action not in ('pause', 'resume') then
    raise exception 'billing_invalid_selection' using errcode = '22023';
  end if;
  s := private.billing_owner_subscription(p_environment, p_user, p_workspace);
  if p_action = 'pause' then
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
revoke all on function public.billing_prepare_lifecycle(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.billing_prepare_lifecycle(text, uuid, uuid, text) to service_role;

-- La pagina Piano dice da quando l'azienda è in pausa. Copia di
-- 20261018000000_billing_subscriptions.sql §10 con `paused_at` in più.
create or replace function public.get_workspace_billing(p_workspace uuid)
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
    'canceled_at', s.canceled_at,
    'paused_at', s.paused_at
  );
end;
$$;
revoke all on function public.get_workspace_billing(uuid) from public, anon, authenticated;
grant execute on function public.get_workspace_billing(uuid) to authenticated;


-- Rinnovo non riuscito senza un periodo pagato prima (il caso che solo un
-- abbonamento appena nato potrebbe avere): il periodo non si annulla. Copia di
-- billing_sync_periods da 20261019000400_past_due_unpaid_period.sql con il solo
-- controllo `exists` in più.
create or replace function private.billing_sync_periods(p_subscription uuid, p_at timestamptz)
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
    if s.refunded_until is not null and s.current_period_ends_at <= s.refunded_until then
      -- Periodo rimborsato: un avviso successivo dello stesso periodo (aumento,
      -- disdetta programmata, metodo di pagamento) non lo riapre. Un rinnovo
      -- pagato dopo il rimborso porta un periodo nuovo e passa dal ramo sotto.
      null;
    elsif last_paid.id is null or s.current_period_starts_at >= last_end then
      -- Primo pagamento, rinnovo o ripresa: un nuovo periodo pagato.
      insert into public.workspace_access_periods (workspace_id, kind, plan, venue_limit,
        starts_at, ends_at, reason, subscription_id)
      values (s.workspace_id, 'subscription', s.plan, v_limit,
        s.current_period_starts_at, s.current_period_ends_at, v_reason, s.id)
      on conflict (subscription_id, kind, starts_at) where subscription_id is not null do update
        set plan = excluded.plan, venue_limit = excluded.venue_limit,
            ends_at = excluded.ends_at, revoked_at = null
        -- Solo un periodo annullato da un rinnovo non riuscito: il pagamento è arrivato.
        where workspace_access_periods.revoked_at is not null
          and workspace_access_periods.revoked_at <= workspace_access_periods.starts_at;
    elsif s.current_period_starts_at > last_paid.starts_at then
      -- Nuovo ciclo prima della fine del precedente (es. da mensile ad annuale).
      update public.workspace_access_periods set revoked_at = s.current_period_starts_at
       where id = last_paid.id;
      insert into public.workspace_access_periods (workspace_id, kind, plan, venue_limit,
        starts_at, ends_at, reason, subscription_id)
      values (s.workspace_id, 'subscription', s.plan, v_limit,
        s.current_period_starts_at, s.current_period_ends_at, v_reason, s.id)
      on conflict (subscription_id, kind, starts_at) where subscription_id is not null do update
        set plan = excluded.plan, venue_limit = excluded.venue_limit,
            ends_at = excluded.ends_at, revoked_at = null
        -- Solo un periodo annullato da un rinnovo non riuscito: il pagamento è arrivato.
        where workspace_access_periods.revoked_at is not null
          and workspace_access_periods.revoked_at <= workspace_access_periods.starts_at;
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
    -- Paddle apre il periodo nuovo (`subscription.updated`, `active`) prima di
    -- incassare: con il rinnovo non riuscito quel periodo non è pagato e si
    -- annulla dal suo inizio. Torna se il pagamento viene recuperato.
    -- Solo se è davvero un rinnovo: prima c'è un periodo pagato dello stesso
    -- abbonamento. Il primo acquisto passa dal checkout e non si annulla.
    update public.workspace_access_periods p set revoked_at = p.starts_at
     where p.subscription_id = p_subscription and p.kind = 'subscription'
       and p.starts_at >= s.current_period_starts_at
       and (p.revoked_at is null or p.revoked_at > p.starts_at)
       and exists (select 1 from public.workspace_access_periods q
                    where q.subscription_id = p_subscription and q.kind = 'subscription'
                      and q.starts_at < s.current_period_starts_at
                      and (q.revoked_at is null or q.revoked_at > q.starts_at));
    last_paid := null;
    last_end := null;
    select * into last_paid from public.workspace_access_periods p
     where p.subscription_id = p_subscription and p.kind = 'subscription'
       and (p.revoked_at is null or p.revoked_at > p.starts_at)
     order by p.starts_at desc, p.created_at desc, p.id desc limit 1;
    if last_paid.id is not null then
      last_end := least(last_paid.ends_at, coalesce(last_paid.revoked_at, last_paid.ends_at));
    end if;
    -- Una tolleranza nata dalla fine del periodo non pagato (prima di questa
    -- correzione) non vale: quella giusta parte dall'ultimo pagato.
    update public.workspace_access_periods g set revoked_at = g.starts_at
     where g.subscription_id = p_subscription and g.kind = 'payment_grace'
       and g.starts_at > last_end
       and (g.revoked_at is null or g.revoked_at > g.starts_at);
    -- Sette giorni dalla fine dell'ultimo periodo pagato, con la sua capacità.
    -- Niente tolleranza dopo un periodo rimborsato: non c'era un pagato da prolungare.
    if last_paid.id is not null and (s.refunded_until is null or last_end >= s.refunded_until) then
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
