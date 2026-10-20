-- Voce 4: quota documenti per azienda (docs/MONETIZATION.md §7).
--
-- 2 GiB per azienda, uguale per Base e Team; una gratuità a vita usa il limite
-- concesso dal fondatore (`workspace_access_periods.document_limit_bytes`).
-- Lo spazio si misura dagli oggetti Storage veri (`metadata.size`), non dalla
-- dimensione dichiarata dal client, contando una volta i documenti delle schede
-- dell'azienda. Raggiunta la quota si bloccano solo i nuovi caricamenti: turni,
-- lettura, download ed export proseguono e nulla viene cancellato. Il controllo
-- sta nella stessa funzione della policy di caricamento, quindi vale anche
-- fuori dall'app; può sforare al più di un file (10 MiB), perché la dimensione
-- del nuovo file la Storage la conosce solo dopo.

create function private.default_document_limit_bytes()
returns bigint language sql immutable set search_path = '' as $$
  select 2147483648::bigint;  -- 2 GiB
$$;

-- Il limite dei periodi in corso (una concessione con il suo limite) o quello base.
create function private.workspace_document_limit(p_workspace uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce((
    select max(p.document_limit_bytes) from public.workspace_access_periods p
     where p.workspace_id = p_workspace and p.document_limit_bytes is not null
       and p.starts_at <= now()
       and coalesce(least(p.ends_at, p.revoked_at), p.ends_at, p.revoked_at, 'infinity'::timestamptz) > now()
  ), private.default_document_limit_bytes());
$$;

-- Byte dei documenti dell'azienda nello Storage (cartella = scheda del membro).
create function private.workspace_document_bytes(p_workspace uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when o.metadata ->> 'size' ~ '^(0|[1-9][0-9]{0,17})$'
                           then (o.metadata ->> 'size')::bigint else 0 end), 0)::bigint
    from storage.objects o
   where o.bucket_id = 'staff-documents'
     and split_part(o.name, '/', 1) in (
       select m.id::text from public.workspace_members m where m.workspace_id = p_workspace);
$$;

-- Copia di private.can_upload_member_documents (20261005000200) con la quota.
create or replace function private.can_upload_member_documents(p_member uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare ws uuid; a jsonb;
begin
  if not private.can_access_member_documents(p_member) then return false; end if;
  select workspace_id into ws from public.workspace_members where id = p_member;
  perform private.lock_commercial_workspace(ws);
  a := private.workspace_access_at(ws, clock_timestamp());
  if a->>'state' not in ('operational','migration_pending') then return false; end if;
  -- Quota piena: niente nuovi file. Il resto (lettura, download) non passa di qui.
  return private.workspace_document_bytes(ws) < private.workspace_document_limit(ws);
end;
$$;

-- Spazio dell'azienda per chi vede i documenti di quella scheda (anche il
-- professionista per i propri): basta a mostrare avvisi e a spiegare un rifiuto.
create function public.get_member_document_quota(p_member uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare ws uuid;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not private.can_access_member_documents(p_member) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select workspace_id into ws from public.workspace_members where id = p_member;
  return jsonb_build_object('used_bytes', private.workspace_document_bytes(ws),
    'limit_bytes', private.workspace_document_limit(ws));
end;
$$;

-- Area fondatore: il limite accanto al consumo. Copia di
-- private.admin_workspace_json (20261006000100) con `document_limit_bytes`.
create or replace function private.admin_workspace_json(p_row private.admin_workspace_rows)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(p_row) || jsonb_build_object('flags', private.admin_workspace_flags(p_row),
    'document_limit_bytes', private.workspace_document_limit(p_row.id));
$$;

revoke all on function private.default_document_limit_bytes(), private.workspace_document_limit(uuid),
  private.workspace_document_bytes(uuid) from public, anon, authenticated;
revoke all on function public.get_member_document_quota(uuid) from public, anon, authenticated;
grant execute on function public.get_member_document_quota(uuid) to authenticated;
