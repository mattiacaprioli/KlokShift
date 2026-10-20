-- Area fondatore: avvisi Paddle scartati.
--
-- `billing_apply_event` scarta (`rejected`) un avviso che non torna: prezzo non
-- nel catalogo, abbonamento non collegato a una richiesta d'acquisto, secondo
-- abbonamento aperto per la stessa azienda, rettifica di un abbonamento
-- sconosciuto… Paddle non lo ritenta (ha ricevuto 200) e il diritto non cambia:
-- serve un occhio umano. Prova sandbox del 19/10: gli avvisi della pausa erano
-- scartati e si vedevano solo dal database. Ora compaiono nell'area fondatore e
-- si chiudono con una nota, come i rimborsi da verificare. Stesse verifiche
-- admin (allowlist, sessione, secondo fattore).

alter table private.billing_events
  add column reviewed_at timestamptz,
  add column reviewed_by uuid,
  add column review_note text,
  add constraint billing_event_review check (
    (reviewed_at is null) = (reviewed_by is null)
    and (reviewed_at is null) = (review_note is null)
    and (review_note is null or char_length(btrim(review_note)) between 3 and 500)
  );
create index billing_events_rejected_idx on private.billing_events (received_at desc)
  where outcome = 'rejected';

-- L'azienda dell'avviso, se si riconosce: dall'abbonamento collegato, dalla
-- richiesta d'acquisto in `custom_data` o dall'abbonamento della rettifica.
create function private.billing_event_workspace(e private.billing_events)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.workspace_id from public.billing_subscriptions s where s.id = e.subscription_id),
    (select c.workspace_id from public.billing_checkouts c
      where c.environment = e.environment
        and c.id::text = e.payload #>> '{data,custom_data,klokshift_checkout}'),
    (select s.workspace_id from public.billing_subscriptions s
      where s.environment = e.environment
        and s.provider_subscription_id = coalesce(e.payload #>> '{data,subscription_id}', e.payload #>> '{data,id}')));
$$;

create function public.admin_list_rejected_billing_events(p_open_only boolean default true, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.require_platform_admin();
  perform private.validate_admin_page('', 25, p_offset);
  if p_open_only is null then raise exception 'admin_invalid_filter' using errcode = '22023'; end if;
  with rows as materialized (
    select e, private.billing_event_workspace(e) as workspace_id
      from private.billing_events e
     where e.outcome = 'rejected' and (not p_open_only or e.reviewed_at is null))
  select jsonb_build_object('generated_at', now(),
    'open_total', (select count(*) from private.billing_events where outcome = 'rejected' and reviewed_at is null),
    'total', (select count(*) from rows), 'limit', 25, 'offset', p_offset,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'environment', (r.e).environment, 'event_id', (r.e).event_id, 'event_type', (r.e).event_type,
        'error', (r.e).error, 'occurred_at', (r.e).occurred_at, 'received_at', (r.e).received_at,
        'paddle_id', (r.e).payload #>> '{data,id}',
        'workspace_id', r.workspace_id, 'workspace_name', (select name from public.workspaces where id = r.workspace_id),
        'reviewed_at', (r.e).reviewed_at, 'review_note', (r.e).review_note)
        order by (r.e).received_at desc), '[]'::jsonb)
      from (select * from rows order by (e).received_at desc, (e).event_id limit 25 offset p_offset) r))
  into result;
  return result;
end;
$$;

create function public.admin_resolve_billing_event(p_environment text, p_event_id text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e private.billing_events;
begin
  perform private.require_platform_admin();
  if p_note is null or char_length(btrim(p_note)) not between 3 and 500 then
    raise exception 'admin_review_note_required' using errcode = '22023';
  end if;
  select * into e from private.billing_events
   where environment = p_environment and event_id = p_event_id for update;
  if not found then raise exception 'admin_not_found' using errcode = 'P0002'; end if;
  if e.outcome <> 'rejected' or e.reviewed_at is not null then
    raise exception 'admin_review_not_open' using errcode = '22023';
  end if;
  update private.billing_events
     set reviewed_at = now(), reviewed_by = (select auth.uid()), review_note = btrim(p_note)
   where environment = p_environment and event_id = p_event_id;
  return jsonb_build_object('environment', p_environment, 'event_id', p_event_id, 'reviewed_at', now());
end;
$$;

revoke all on function private.billing_event_workspace(private.billing_events) from public, anon, authenticated;
revoke all on function public.admin_list_rejected_billing_events(boolean, integer),
  public.admin_resolve_billing_event(text, text, text) from public, anon, authenticated;
grant execute on function public.admin_list_rejected_billing_events(boolean, integer),
  public.admin_resolve_billing_event(text, text, text) to authenticated;
