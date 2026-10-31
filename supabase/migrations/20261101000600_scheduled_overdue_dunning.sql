-- Cambio piano al rinnovo: il rinnovo in sospeso non è un rinnovo scaduto.
-- Copia di private.queue_scheduled_billing_work da 20261101000300_billing_scheduled_runner.sql
-- con il passo 3 che salta gli abbonamenti `past_due`: Paddle ha rinnovato e
-- ritenta il pagamento, e il trigger dell'avviso (20261101000100) lascia
-- aperto apposta il cambio inviato finché il pagamento non si recupera. Prima
-- di qui, due ore dopo la data il giro lo chiudeva come `renewal_overdue`: un
-- allarme falso al fondatore e un rinnovo recuperato mai confermato.
-- Stessa firma: privilegi invariati (revocati in 20261101000300).

create or replace function private.queue_scheduled_billing_work(p_at timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare
  c record;
  o record;
  v_error text;
  v_state text;
  v_count integer := 0;
begin
  -- 1. Promemoria: una volta per cambio, a ogni titolare attivo. La notifica
  --    resta neutra (niente prezzi nell'app nativa); l'email con i dettagli la
  --    spedisce la Edge Function a chi ha chiesto il cambio.
  for c in
    select s.id, s.effective_at, w.id as workspace_id, w.name
      from public.billing_scheduled_changes s
      join public.workspaces w on w.id = s.workspace_id
     where s.status = 'pending' and s.reminder_notified_at is null
       and s.effective_at > p_at
       and s.effective_at - private.billing_schedule_reminder_lead() <= p_at
       and s.created_at <= s.effective_at - private.billing_schedule_reminder_lead()
       and w.deleted_at is null
     for update of s
  loop
    begin
      for o in
        select m.user_id from public.workspace_members m
         where m.workspace_id = c.workspace_id and m.authority = 'owner' and m.status = 'active'
           and m.user_id is not null
      loop
        perform private.notify(o.user_id, 'billing_change_reminder',
          'Cambia l''abbonamento di ' || c.name,
          'Dal ' || private.rome_date(c.effective_at)
            || ' cambia il piano dell''azienda. I dettagli sono nella pagina Piano sul web.',
          c.workspace_id);
      end loop;
      update public.billing_scheduled_changes set reminder_notified_at = p_at where id = c.id;
      v_count := v_count + 1;
    exception when others then
      raise warning 'queue_scheduled_billing_work: promemoria % non riuscito (%)', c.id, sqlstate;
    end;
  end loop;

  -- 2. Regole cambiate dentro la finestra d'invio: il cambio non parte. Il
  --    rinnovo avverrà col piano attuale, in modo visibile, e il fondatore lo
  --    sistema a mano. Un'azienda cancellata o non più operativa (anche per un
  --    rimborso che ha tolto l'accesso) conta come regola cambiata.
  for c in
    select s.id, s.subscription_id, s.workspace_id, s.target_plan, s.target_interval,
           s.target_extra_venues, w.deleted_at
      from public.billing_scheduled_changes s
      join public.workspaces w on w.id = s.workspace_id
     where s.status = 'pending'
       and s.effective_at > p_at
       and s.effective_at - private.billing_schedule_window() <= p_at
     for update of s
  loop
    begin
      if c.deleted_at is not null then
        v_error := 'workspace_deleted';
      else
        v_error := private.billing_scheduled_rules_error(c.subscription_id, c.target_plan,
          c.target_interval, c.target_extra_venues);
        -- Abbonamento già al punto d'arrivo: la PATCH è arrivata a Paddle ma il
        -- suo esito si è perso (timeout, RPC fallita) e l'avviso l'ha applicata.
        -- Non è una regola cambiata: resta in attesa, la prossima presa in carico
        -- lo chiude come inviato (`alreadyApplied` della Edge Function) e il
        -- rinnovo lo conferma. Fallirlo darebbe al titolare un «resta il piano
        -- attuale» falso e al fondatore un allarme a vuoto.
        if v_error = 'billing_no_change' then
          v_error := null;
        end if;
        if v_error is null then
          v_state := private.workspace_access_at(c.workspace_id, p_at) ->> 'state';
          if v_state is distinct from 'operational' then
            v_error := 'workspace_not_operational';
          end if;
        end if;
      end if;
      if v_error is not null then
        update public.billing_scheduled_changes
           set status = 'failed', close_reason = 'rules_changed', closed_at = p_at,
               last_error_code = v_error, alert_kind = 'failed'
         where id = c.id;
        perform private.billing_scheduled_notify_failed(c.id);
        v_count := v_count + 1;
      end if;
    exception when others then
      raise warning 'queue_scheduled_billing_work: regole del cambio % non ricontrollate (%)', c.id, sqlstate;
    end;
  end loop;

  -- 3. Rinnovo passato da due ore e cambio ancora aperto: nessun avviso del
  --    rinnovo l'ha chiuso, e lo stato su Paddle non si conosce (rinnovo
  --    spostato, avviso perso). Si chiude con l'allarme al fondatore, che
  --    controlla data e articoli su Paddle. Il titolare non è avvisato: non si
  --    sa cosa dirgli. Chiuso, non blocca più aumenti, cambi né capacità.
  --    Un rinnovo in sospeso (`past_due`) no: l'avviso è arrivato, Paddle
  --    ritenta il pagamento e al recupero il trigger dell'avviso conferma.
  for c in
    select s.id from public.billing_scheduled_changes s
     where s.status in ('pending', 'applied')
       and s.effective_at < p_at - private.billing_schedule_overdue_lag()
       and not exists (select 1 from public.billing_subscriptions b
                        where b.id = s.subscription_id and b.status = 'past_due')
     for update
  loop
    begin
      update public.billing_scheduled_changes
         set status = 'failed', close_reason = 'renewal_overdue', closed_at = p_at,
             alert_kind = 'renewal_overdue'
       where id = c.id;
      v_count := v_count + 1;
    exception when others then
      raise warning 'queue_scheduled_billing_work: rinnovo scaduto del cambio % non chiuso (%)', c.id, sqlstate;
    end;
  end loop;

  -- 4. A 6 ore dal rinnovo un cambio ancora da inviare fa scattare l'allarme
  --    (una volta: l'email al fondatore non si ripete per lo stesso cambio).
  --    Un allarme già acceso resta il suo: `date_not_fixed` dice di più, e il
  --    ritentativo del fondatore lo tiene apposta.
  for c in
    select s.id from public.billing_scheduled_changes s
     where s.status = 'pending' and s.alert_kind is null
       and s.effective_at - private.billing_schedule_alert_lead() <= p_at
     for update
  loop
    begin
      update public.billing_scheduled_changes set alert_kind = 'not_sent' where id = c.id;
      v_count := v_count + 1;
    exception when others then
      raise warning 'queue_scheduled_billing_work: allarme del cambio % non acceso (%)', c.id, sqlstate;
    end;
  end loop;
  return v_count;
end;
$$;
