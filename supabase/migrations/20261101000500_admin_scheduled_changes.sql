-- Area fondatore: cambi di piano programmati da verificare.
--
-- `billing_scheduled_changes` (20261101000000) segna un allarme (`alert_kind`)
-- quando il cambio non è arrivato a Paddle a 6 ore dal rinnovo, non si può più
-- applicare, o il rinnovo è avvenuto con un piano diverso. Il fondatore li vede
-- nell'area amministrativa, li chiude con una nota e può rimandare un cambio
-- non ancora scaduto. Stesse regole delle altre RPC admin: allowlist, sessione
-- viva e secondo fattore rivalutati a ogni chiamata (private.require_platform_admin).

alter table public.billing_scheduled_changes
  add constraint billing_scheduled_change_review check (
    (reviewed_at is null) = (reviewed_by is null)
    and (reviewed_at is null) = (review_note is null)
    and (review_note is null or char_length(btrim(review_note)) between 3 and 500)
  );

-- Un allarme nuovo riapre la verifica. Il fondatore può chiudere un `not_sent`
-- mentre il cambio è ancora in attesa; se poi fallisce (runner, esito di
-- Paddle) o il rinnovo arriva con un piano diverso (reconcile), quelle strade
-- cambiano `alert_kind` ma non toccano la revisione: senza questo la riga non
-- tornerebbe «da verificare», l'email verrebbe saltata e il rinnovo al prezzo
-- vecchio passerebbe in silenzio (§7.6, §8.3). Si azzera anche l'email
-- d'allarme, così parte di nuovo per il nuovo motivo. Un aggiornamento che non
-- cambia l'allarme, o che lo toglie (il ritentativo), lascia tutto com'è.
create function private.billing_scheduled_alert_reopen()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.alert_kind is not null and new.alert_kind is distinct from old.alert_kind then
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.review_note := null;
    new.alert_emailed_at := null;
    new.alert_email_attempts := 0;
  end if;
  return new;
end;
$$;
revoke all on function private.billing_scheduled_alert_reopen() from public, anon, authenticated;

create trigger billing_scheduled_changes_alert_reopen
  before update on public.billing_scheduled_changes
  for each row execute function private.billing_scheduled_alert_reopen();

-- Ogni allarme nuovo arriva anche ai fondatori (l'allowlist di
-- private.require_platform_admin, senza i revocati né gli account eliminati)
-- con una notifica nell'app e una push. La push la manda la Edge Function
-- `push`, non `billing-scheduled`: se quella è giù o mal configurata (email,
-- `FOUNDER_ALERT_EMAIL`), l'allarme non si perde con lei. Una riga per tipo
-- d'allarme: un aggiornamento che non lo cambia non ne manda un'altra. Niente
-- importi; l'azienda per nome anche se cancellata. Il testo dice lo stesso del
-- pannello (web/src/admin/ScheduledChanges.tsx).
create function private.billing_scheduled_notify_admins()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_body text;
  a record;
begin
  select w.name into v_name from public.workspaces w where w.id = new.workspace_id;
  v_body := case new.alert_kind
    when 'not_sent' then 'Non è ancora arrivato a Paddle e il rinnovo è vicino.'
    when 'failed' then 'Non si può applicare: al rinnovo resta il piano attuale.'
    when 'renewal_mismatch' then case when new.close_reason = 'renewal_mismatch'
      then 'Il rinnovo è avvenuto con un piano diverso da quello programmato.'
      else 'Paddle ha ricevuto il cambio, ma qui risultava già chiuso.' end
    when 'date_not_fixed' then 'Il ciclo è cambiato su Paddle ma la data del rinnovo no.'
    when 'renewal_overdue' then 'Paddle non ha rinnovato alla data del cambio.'
    else 'C''è un avviso nuovo.'
  end || ' Apri l''area fondatore.';
  for a in
    select pa.user_id from private.platform_admins pa
      join auth.users u on u.id = pa.user_id
      join public.profiles p on p.id = pa.user_id
     where pa.revoked_at is null and u.deleted_at is null
  loop
    perform private.notify(a.user_id, 'billing_admin_alert',
      'Cambio di piano da controllare: ' || coalesce(v_name, 'azienda'), v_body, new.workspace_id);
  end loop;
  return null;
end;
$$;
revoke all on function private.billing_scheduled_notify_admins() from public, anon, authenticated;

create trigger billing_scheduled_changes_notify_admins
  after update of alert_kind on public.billing_scheduled_changes
  for each row when (new.alert_kind is not null and new.alert_kind is distinct from old.alert_kind)
  execute function private.billing_scheduled_notify_admins();

create function private.admin_scheduled_change_json(c public.billing_scheduled_changes)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'workspace_id', c.workspace_id, 'workspace_name', w.name,
    'environment', c.environment, 'status', c.status, 'close_reason', c.close_reason,
    'target_plan', c.target_plan, 'target_interval', c.target_interval,
    'target_extra_venues', c.target_extra_venues, 'effective_at', c.effective_at,
    'renewal_cents', c.renewal_cents, 'currency', c.currency, 'attempts', c.attempts,
    'last_error_code', c.last_error_code, 'alert_kind', c.alert_kind,
    'created_at', c.created_at, 'applied_at', c.applied_at, 'confirmed_at', c.confirmed_at,
    'reviewed_at', c.reviewed_at, 'review_note', c.review_note,
    -- Come sulla scheda dell'azienda; senza scheda, il nome del profilo.
    'requested_by_name', private.member_name(c.workspace_id, c.requested_by))
  from public.workspaces w where w.id = c.workspace_id;
$$;
revoke all on function private.admin_scheduled_change_json(public.billing_scheduled_changes)
  from public, anon, authenticated;

-- Elenco: da verificare (predefinito) o tutto lo storico; anche per una sola azienda.
create function public.admin_list_scheduled_billing_changes(p_workspace uuid default null,
  p_attention_only boolean default true, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.require_platform_admin();
  perform private.validate_admin_page('', p_limit, p_offset);
  if p_attention_only is null then raise exception 'admin_invalid_filter' using errcode = '22023'; end if;
  with rows as materialized (
    select c, (c.alert_kind is not null and c.reviewed_at is null) as attention
      from public.billing_scheduled_changes c
     where p_workspace is null or c.workspace_id = p_workspace)
  select jsonb_build_object('generated_at', now(),
    'open_total', (select count(*) from rows where attention),
    'total', (select count(*) from rows where not p_attention_only or attention),
    'limit', p_limit, 'offset', p_offset,
    'items', (select coalesce(jsonb_agg(private.admin_scheduled_change_json(r.c) order by (r.c).created_at desc, (r.c).id), '[]'::jsonb)
      from (select * from rows where not p_attention_only or attention
             order by (c).created_at desc, (c).id
             limit p_limit offset p_offset) r))
  into result;
  return result;
end;
$$;

-- Chiusura con nota: chi, quando e perché. Solo per un avviso ancora aperto.
create function public.admin_resolve_scheduled_billing_change(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.billing_scheduled_changes;
begin
  perform private.require_platform_admin();
  if p_note is null or char_length(btrim(p_note)) not between 3 and 500 then
    raise exception 'admin_review_note_required' using errcode = '22023';
  end if;
  select * into c from public.billing_scheduled_changes where id = p_id for update;
  if not found then raise exception 'admin_not_found' using errcode = 'P0002'; end if;
  if c.alert_kind is null or c.reviewed_at is not null then
    raise exception 'admin_review_not_open' using errcode = '22023';
  end if;
  update public.billing_scheduled_changes
     set reviewed_at = now(), reviewed_by = (select auth.uid()), review_note = btrim(p_note)
   where id = p_id;
end;
$$;

-- Ritentativo: solo con il rinnovo ancora davanti, e non se il rinnovo è già
-- avvenuto con un piano diverso. Rimette la riga in coda e dà una spinta al
-- lavoro pianificato; le regole le ricontrolla lui. Un `date_not_fixed` resta
-- acceso (gli articoli sono già su Paddle, e così il passo «non inviato» non
-- lo sostituisce): si azzerano solo revisione, email, tentativi e attesa.
create function public.admin_retry_scheduled_billing_change(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.billing_scheduled_changes;
begin
  perform private.require_platform_admin();
  select * into c from public.billing_scheduled_changes where id = p_id for update;
  if not found then raise exception 'admin_not_found' using errcode = 'P0002'; end if;
  if c.status not in ('pending', 'failed') or c.effective_at <= now()
     or c.alert_kind = 'renewal_mismatch' or c.close_reason = 'renewal_mismatch' then
    raise exception 'scheduled_change_not_retryable' using errcode = '23514';
  end if;
  if exists (select 1 from public.billing_scheduled_changes
              where subscription_id = c.subscription_id and status in ('pending', 'applied') and id <> c.id) then
    raise exception 'billing_change_pending' using errcode = '23514';
  end if;
  update public.billing_scheduled_changes
     set status = 'pending', attempts = 0, next_attempt_at = now(), last_error_code = null,
         alert_kind = case when c.alert_kind = 'date_not_fixed' then 'date_not_fixed' end,
         alert_emailed_at = null, alert_email_attempts = 0,
         close_reason = null, closed_at = null, closed_by = null,
         reviewed_at = null, reviewed_by = null, review_note = null
   where id = p_id;
  perform private.run_scheduled_billing_changes();
end;
$$;

revoke all on function public.admin_list_scheduled_billing_changes(uuid, boolean, integer, integer),
  public.admin_resolve_scheduled_billing_change(uuid, text),
  public.admin_retry_scheduled_billing_change(uuid) from public, anon, authenticated;
grant execute on function public.admin_list_scheduled_billing_changes(uuid, boolean, integer, integer),
  public.admin_resolve_scheduled_billing_change(uuid, text),
  public.admin_retry_scheduled_billing_change(uuid) to authenticated;
