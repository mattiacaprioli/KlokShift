-- M11: cancellazione dei dati su richiesta del cliente, anche prima della fine
-- dell'archivio (termini, §8: «Puoi chiederne la cancellazione anche prima,
-- scrivendoci»). La richiesta arriva per email; il fondatore la esegue dalla
-- scheda dell'azienda. Stesse garanzie della cancellazione a fine archivio
-- (nome esatto, motivo, nessun abbonamento aperto, registro), ma l'azienda può
-- essere in archivio o non ancora attivata: mai operativa.
--
-- Nuovo parametro `p_customer_request` (predefinito false): la firma cambia,
-- quindi la funzione si ricrea. Corpo copiato da 20261020000000 §6 con il
-- controllo dello stato e l'esito estesi.

drop function public.admin_delete_workspace_data(uuid, uuid, text, text);

create function public.admin_delete_workspace_data(p_workspace uuid, p_operation uuid,
  p_confirm_name text, p_reason text, p_customer_request boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w public.workspaces;
  v_params jsonb := jsonb_build_object('confirm_name', p_confirm_name,
    'customer_request', coalesce(p_customer_request, false));
  v_state text;
  v_replay jsonb;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  perform private.require_platform_admin();
  if p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then
    raise exception 'admin_reason_required' using errcode = '22023';
  end if;
  v_replay := private.admin_operation_replay(p_operation, 'workspace', p_workspace, 'delete_data', v_params);
  if v_replay is not null then return v_replay; end if;

  perform private.lock_commercial_workspace(p_workspace);
  select * into w from public.workspaces where id = p_workspace for update;
  if not found then raise exception 'admin_not_found' using errcode = 'P0002'; end if;
  if w.data_deleted_at is not null then
    raise exception 'admin_data_already_deleted' using errcode = '23514';
  end if;
  if p_confirm_name is null or btrim(p_confirm_name) <> btrim(w.name) then
    raise exception 'admin_confirm_name_mismatch' using errcode = '22023';
  end if;
  v_state := private.workspace_access_at(p_workspace, now()) ->> 'state';
  if coalesce(p_customer_request, false) then
    -- Su richiesta del cliente anche prima della scadenza, ma mai mentre lavora.
    if v_state = 'operational' then
      raise exception 'admin_workspace_operational' using errcode = '23514';
    end if;
  elsif v_state <> 'expired' then
    raise exception 'admin_archive_not_expired' using errcode = '23514';
  end if;
  if exists (select 1 from public.billing_subscriptions
              where workspace_id = p_workspace and status <> 'canceled') then
    raise exception 'admin_subscription_open' using errcode = '23514';
  end if;

  v_before := private.workspace_data_inventory(p_workspace);
  -- Niente «Turno revocato» alle persone, niente guardie commerciali.
  perform set_config('app.staff_exit', '1', true);
  perform set_config('app.workspace_data_deletion', '1', true);

  -- File da togliere dallo Storage: documenti del personale e loghi delle sedi
  -- (caricati fra le foto, nella cartella di chi li ha messi). Un logo usato
  -- anche come foto profilo resta.
  insert into public.workspace_file_cleanup (workspace_id, bucket_id, object_name)
  select p_workspace, 'staff-documents', d.storage_path
    from public.staff_documents d join public.workspace_members m on m.id = d.member_id
   where m.workspace_id = p_workspace and btrim(coalesce(d.storage_path, '')) <> ''
  union
  select p_workspace, 'avatars', substring(v.logo_url from '/storage/v1/object/public/avatars/(.+)$')
    from public.venues v
   where v.workspace_id = p_workspace and v.logo_url ~ '/storage/v1/object/public/avatars/.+'
     and not exists (select 1 from public.profiles p where p.avatar_url = v.logo_url)
  on conflict (workspace_id, bucket_id, object_name) do nothing;

  delete from public.notifications
   where person_id in (select id from public.workspace_members where workspace_id = p_workspace);
  delete from public.conversations where workspace_id = p_workspace;
  -- Le timbrature non hanno FK verso la sede e bloccano la cancellazione dei turni.
  delete from public.shift_clock_records
   where venue_id in (select id from public.venues where workspace_id = p_workspace);
  delete from public.venues where workspace_id = p_workspace;
  -- Prima dei membri: un'azienda chiusa non pretende più un titolare.
  update public.workspaces
     set deleted_at = coalesce(deleted_at, now()), data_deleted_at = now()
   where id = p_workspace;
  delete from public.workspace_members where workspace_id = p_workspace;

  v_after := private.workspace_data_inventory(p_workspace);
  v_result := jsonb_build_object('workspace_id', p_workspace, 'data_deleted_at', now(),
    'customer_request', coalesce(p_customer_request, false),
    'deleted', v_before - 'files_pending', 'files_pending', v_after -> 'files_pending');
  insert into private.admin_operations (operation_id, actor_id, target_kind, target_id, action,
    reason, parameters, before_state, after_state, result, applied_at)
  values (p_operation, (select auth.uid()), 'workspace', p_workspace, 'delete_data',
    btrim(p_reason), v_params, v_before, v_after, v_result, now());
  return v_result;
end;
$$;


revoke all on function public.admin_delete_workspace_data(uuid, uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.admin_delete_workspace_data(uuid, uuid, text, text, boolean) to authenticated;
