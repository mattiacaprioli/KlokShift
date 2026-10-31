-- Cambio piano al rinnovo, quarto blocco: il lavoro pianificato (design
-- docs/superpowers/specs/2026-10-31-cambio-piano-al-rinnovo-design.md §7.5,
-- §7.6, §8.3, §8.4).
--
-- Ogni 10 minuti `private.run_scheduled_billing_changes` (pg_cron):
--   1. promemoria al titolare 7 giorni prima del rinnovo, solo se il cambio è
--      stato chiesto almeno 7 giorni prima (altrimenti basta la conferma a
--      schermo): notifica nell'app subito, email dalla Edge Function;
--   2. dentro la finestra d'invio (24 ore) ricontrolla le regole: se non valgono
--      più il cambio non parte, diventa `failed`, scatta l'allarme al fondatore
--      e i titolari lo sanno dall'app (anche per un errore permanente di Paddle);
--   3. due ore dopo la data d'effetto un cambio ancora aperto (nessun avviso
--      del rinnovo) si chiude con l'allarme `renewal_overdue`: lo stato su
--      Paddle non si conosce, il titolare non è avvisato e torna libero;
--   4. a 6 ore dal rinnovo un cambio non ancora inviato fa scattare l'allarme;
--   5. se c'è da fare, chiama la Edge Function `billing-scheduled` con pg_net e
--      il segreto Vault delle push (come `run_archive_reminders`).
-- Ogni riga ha il suo blocco d'eccezione: un'azienda che fa fallire un
-- controllo finisce nel log (`raise warning`) e non ferma le altre.
-- Ogni allarme nuovo arriva al fondatore anche con una push
-- (`billing_admin_alert`, 20261101000500), che non dipende da questa Edge Function.
--
-- La Edge Function prende in carico i cambi (`billing_scheduled_claim`), parla
-- con Paddle e registra l'esito (`billing_scheduled_result`). Nessuna di queste
-- funzioni concede nulla: piano e capacità cambiano solo con l'avviso firmato.
-- Le righe col rinnovo già passato non si prendono più: le chiude l'avviso del
-- rinnovo (`billing_scheduled_reconcile`).

-- Il tipo nuovo non si usa come letterale in questa migration fuori dai corpi
-- plpgsql: un valore aggiunto non è utilizzabile nella stessa transazione.
alter type public.notification_type add value if not exists 'billing_change_reminder';
-- Allarme al fondatore, nell'app e in push (20261101000500).
alter type public.notification_type add value if not exists 'billing_admin_alert';

-- Le soglie, accanto a `private.billing_schedule_window()`: un solo valore per
-- il lavoro e per i test.
create function private.billing_schedule_alert_lead()
returns interval language sql immutable set search_path = '' as $$
  select interval '6 hours'
$$;
create function private.billing_schedule_reminder_lead()
returns interval language sql immutable set search_path = '' as $$
  select interval '7 days'
$$;
-- Oltre la data d'effetto l'avviso del rinnovo di norma arriva in pochi
-- minuti: dopo due ore un cambio ancora aperto non ha più un'uscita da sé.
create function private.billing_schedule_overdue_lag()
returns interval language sql immutable set search_path = '' as $$
  select interval '2 hours'
$$;
revoke all on function private.billing_schedule_alert_lead(), private.billing_schedule_reminder_lead(),
  private.billing_schedule_overdue_lag() from public, anon, authenticated;

-- Il cambio è fallito prima del rinnovo (regole cambiate o errore permanente
-- di Paddle): ogni titolare attivo lo sa dall'app, con lo stesso tipo del
-- promemoria e un testo neutro, senza prezzi. Niente email al titolare.
-- L'esito del rinnovo (`renewal_mismatch`) non passa di qui: arriva dopo, ed è
-- del fondatore. Un'azienda cancellata non ha più una pagina Piano: niente.
create function private.billing_scheduled_notify_failed(p_change uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c record;
  o record;
begin
  select s.effective_at, w.id as workspace_id, w.name into c
    from public.billing_scheduled_changes s
    join public.workspaces w on w.id = s.workspace_id
   where s.id = p_change and w.deleted_at is null;
  if not found then
    return;
  end if;
  for o in
    select m.user_id from public.workspace_members m
     where m.workspace_id = c.workspace_id and m.authority = 'owner' and m.status = 'active'
       and m.user_id is not null
  loop
    perform private.notify(o.user_id, 'billing_change_reminder',
      'Il cambio dell''abbonamento di ' || c.name || ' non si applica',
      'Al rinnovo del ' || private.rome_date(c.effective_at)
        || ' resta il piano attuale. I dettagli sono nella pagina Piano sul web.',
      c.workspace_id);
  end loop;
end;
$$;
revoke all on function private.billing_scheduled_notify_failed(uuid) from public, anon, authenticated;

-- Promemoria, regole ricontrollate e allarmi; restituisce le righe toccate.
-- `p_at` è l'istante del lavoro (i test lo spostano in avanti).
create function private.queue_scheduled_billing_work(p_at timestamptz default now())
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
  for c in
    select s.id from public.billing_scheduled_changes s
     where s.status in ('pending', 'applied')
       and s.effective_at < p_at - private.billing_schedule_overdue_lag()
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

-- Il lavoro dei 10 minuti: coda, notifiche e, se c'è qualcosa da inviare o da
-- spedire, la chiamata alla Edge Function (asincrona, parte dopo il COMMIT).
create function private.run_scheduled_billing_changes()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_secret text;
begin
  perform private.queue_scheduled_billing_work(now());
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'push_hook_secret' limit 1;
  if v_secret is not null and exists (
       select 1 from public.billing_scheduled_changes
        where (status = 'pending' and effective_at > now()
               and effective_at - private.billing_schedule_window() <= now()
               and next_attempt_at <= now())
           or (reminder_notified_at is not null and reminder_emailed_at is null
               and reminder_email_attempts < 5)
           or (alert_kind is not null and alert_emailed_at is null
               and alert_email_attempts < 5 and reviewed_at is null)) then
    perform net.http_post(
      url     := 'https://rmlobxjlqlpixkvrzmfg.supabase.co/functions/v1/billing-scheduled',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
      body    := '{}'::jsonb);
  end if;
end;
$$;

revoke all on function private.queue_scheduled_billing_work(timestamptz),
  private.run_scheduled_billing_changes() from public, anon, authenticated;

-- Presa in carico (solo service role): i cambi da inviare di quest'ambiente,
-- dentro la finestra e col tentativo dovuto. Escono dalla coda per 15 minuti
-- prima di tornare alla Edge Function, così due giri sovrapposti non li inviano
-- due volte (`skip locked` per quelli presi nello stesso momento).
create function public.billing_scheduled_claim(p_environment text, p_limit integer default 10)
returns setof public.billing_scheduled_changes language sql security definer set search_path = '' as $$
  with picked as (
    select id from public.billing_scheduled_changes
     where environment = p_environment and status = 'pending'
       and effective_at > now()
       and effective_at - private.billing_schedule_window() <= now()
       and next_attempt_at <= now()
     order by effective_at, id
     limit least(greatest(coalesce(p_limit, 10), 1), 50)
     for update skip locked
  )
  update public.billing_scheduled_changes c
     set next_attempt_at = now() + interval '15 minutes'
    from picked
   where c.id = picked.id
  returning c.*
$$;
revoke all on function public.billing_scheduled_claim(text, integer) from public, anon, authenticated;
grant execute on function public.billing_scheduled_claim(text, integer) to service_role;

-- Esito dell'invio (solo service role). Conta solo su una riga ancora in
-- attesa: se nel frattempo è stata chiusa (pausa, disdetta, regole) l'esito
-- arrivato tardi non la riapre.
--   ok          → `applied`; un «non inviato» non ancora spedito per email si
--                 spegne (il cambio è arrivato). Su una riga già chiusa
--                 (annullata o fallita) lo stato resta, ma Paddle ha il cambio:
--                 allarme `renewal_mismatch` al fondatore;
--   permanente  → `failed` con allarme: `paddle_mismatch` se su Paddle il
--                 rinnovo o gli articoli non sono più quelli della richiesta,
--                 altrimenti `paddle_error`. `paddle_date_not_fixed_final`
--                 (cambio di ciclo con gli articoli su Paddle e la data del
--                 rinnovo che non si può più rimettere) chiude con
--                 `date_not_fixed` e nessun avviso al titolare: gli articoli
--                 nuovi sono su Paddle, «resta il piano attuale» sarebbe falso;
--   transitorio → si riprova, con attesa 10, 20, 40 e poi 60 minuti;
--                 `paddle_date_not_fixed` (cambio di ciclo con gli articoli su
--                 Paddle ma la data del rinnovo non rimessa: Paddle fa
--                 ripartire il periodo dalla PATCH) accende anche l'allarme
--                 `date_not_fixed`. Resta dopo `applied`, finché il fondatore
--                 non lo chiude con una nota.
create function public.billing_scheduled_result(p_id uuid, p_ok boolean, p_error text, p_permanent boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.billing_scheduled_changes;
  v_code text := left(coalesce(nullif(p_error, ''), 'unknown_error'), 100);
begin
  select * into c from public.billing_scheduled_changes where id = p_id for update;
  if not found then
    return;
  end if;
  if c.status <> 'pending' then
    if coalesce(p_ok, false) and c.status in ('canceled', 'failed') then
      update public.billing_scheduled_changes set alert_kind = 'renewal_mismatch' where id = c.id;
    end if;
    return;
  end if;
  if coalesce(p_ok, false) then
    update public.billing_scheduled_changes
       set status = 'applied', applied_at = now(),
           alert_kind = case when c.alert_kind = 'not_sent' and c.alert_emailed_at is null
                             then null else c.alert_kind end
     where id = c.id;
  elsif coalesce(p_permanent, false) and v_code = 'paddle_date_not_fixed_final' then
    update public.billing_scheduled_changes
       set status = 'failed', closed_at = now(), attempts = c.attempts + 1,
           close_reason = 'date_not_fixed', last_error_code = v_code, alert_kind = 'date_not_fixed'
     where id = c.id;
  elsif coalesce(p_permanent, false) then
    update public.billing_scheduled_changes
       set status = 'failed', closed_at = now(), attempts = c.attempts + 1,
           close_reason = case when v_code in ('paddle_period_moved', 'paddle_items_changed')
                               then 'paddle_mismatch' else 'paddle_error' end,
           last_error_code = v_code, alert_kind = 'failed'
     where id = c.id;
    perform private.billing_scheduled_notify_failed(c.id);
  else
    update public.billing_scheduled_changes
       set attempts = c.attempts + 1, last_error_code = v_code,
           alert_kind = case when v_code = 'paddle_date_not_fixed' then 'date_not_fixed' else c.alert_kind end,
           next_attempt_at = now() + make_interval(mins => least(10 * 2 ^ least(c.attempts, 3), 60)::integer)
     where id = c.id;
  end if;
end;
$$;
revoke all on function public.billing_scheduled_result(uuid, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.billing_scheduled_result(uuid, boolean, text, boolean) to service_role;

-- Ogni 10 minuti. Se pg_cron non c'è (banco locale) la migration non si ferma:
-- il lavoro si programma dove esiste.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('billing-scheduled-changes', '*/10 * * * *',
    'select private.run_scheduled_billing_changes()');
exception when others then
  raise notice 'pg_cron non disponibile: cambi programmati non pianificati (%).', sqlerrm;
end $$;
