-- Baseline — 6/N: dall'account alla scheda.
--
-- Quando una persona si registra e CONFERMA l'email, ogni scheda preparata per
-- quell'indirizzo si aggancia al suo account. `email_confirmed_at is not null`
-- è l'unico cardine di sicurezza: separa «ti colleghiamo alla tua scheda» da
-- «chiunque scriva l'email di un altro entra nel suo organico». Non si toglie.
--
-- Dipendente: la scheda era già `active`, resta tale — scrivere l'email di un
-- collega e poi registrarsi con quell'indirizzo confermato è il consenso.
-- Collaboratore: la scheda resta `invited`. Qui si entra nella GESTIONE di
-- un'azienda, non in un organico: l'aggancio non basta, deve accettare dentro
-- l'app (respond_to_invite).
--
-- Il ruolo dell'account non entra più da nessuna parte: non è un confine.

create function private.link_member_invites(p_user uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_confirmed timestamptz;
  v_linked integer := 0;
  r record;
  v_owner uuid;
begin
  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed
    from auth.users u where u.id = p_user;
  if v_email is null or v_confirmed is null then
    return 0;
  end if;

  for r in
    select m.id, m.workspace_id, m.display_name, w.name as workspace_name
      from public.workspace_members m
      join public.workspaces w on w.id = m.workspace_id
     where m.user_id is null and lower(m.email) = v_email and m.status <> 'left'
       for update of m
  loop
    if exists (
      select 1 from public.workspace_members x
       where x.workspace_id = r.workspace_id and x.user_id = p_user
    ) then
      -- Questo account è già in azienda con un'altra scheda: non si fonde da sé,
      -- lo decide il titolare.
      update public.workspace_members set link_conflict_at = now() where id = r.id;
      continue;
    end if;

    update public.workspace_members set user_id = p_user where id = r.id;
    v_linked := v_linked + 1;

    for v_owner in
      select m.user_id from public.workspace_members m
       where m.workspace_id = r.workspace_id and m.authority = 'owner'
         and m.status = 'active' and m.user_id is not null
    loop
      perform private.notify(
        v_owner, 'staff_linked', 'Scheda collegata',
        r.display_name || ' ha creato l''account ed è stato collegato alla sua scheda.',
        r.id
      );
    end loop;
  end loop;

  return v_linked;
end;
$$;

-- Rete di sicurezza chiamata dal client a ogni accesso: se il trigger sotto è
-- stato saltato o l'email è stata confermata a schede già create, l'aggancio
-- avviene comunque.
create function public.claim_invites()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  return private.link_member_invites(v_uid);
end;
$$;
grant execute on function public.claim_invites() to authenticated;

-- ---------------------------------------------------------------------------
-- Trigger su auth.users
-- ---------------------------------------------------------------------------
-- Crea il profilo alla registrazione e aggancia le schede quando l'email risulta
-- confermata. NON DEVE MAI sollevare: un errore qui bloccherebbe la registrazione
-- di chiunque. Ogni ramo è avvolto e ripiega su un warning; il client ha comunque
-- `claim_invites()` e l'INSERT sul proprio profilo.
create function private.handle_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    if tg_op = 'INSERT' then
      insert into public.profiles (id, full_name)
      values (new.id, nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''))
      on conflict (id) do nothing;
    end if;

    if new.email_confirmed_at is not null
       and (tg_op = 'INSERT' or old.email_confirmed_at is null) then
      perform private.link_member_invites(new.id);
    end if;
  exception when others then
    raise warning 'handle_auth_user(%): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create trigger on_auth_user_change
  after insert or update of email_confirmed_at on auth.users
  for each row execute function private.handle_auth_user();
