-- Matricola della persona (2026-11-04).
--
-- Il codice del dipendente nel programma paghe del consulente: va nei CSV
-- della pagina Ore accanto al nome, così il consulente non ricodifica a mano e
-- due omonimi non si confondono. Come fanno Fluida («ID esterno» dell'utente) e
-- Planday («Salary identifier»).
--
-- Sta in member_hr con il contratto e la nota HR: la leggono la persona e chi
-- ha «Team» su di lei, non i colleghi. La scrive `update_member` con le stesse
-- regole del contratto.
--
-- ⚠️ Unica dentro l'azienda, senza distinzione di maiuscole e con gli usciti
-- compresi (le ore passate di chi è uscito restano sue: un nuovo dipendente con
-- la stessa matricola diventerebbe la stessa persona nel programma paghe).
-- Non è un indice perché member_hr non porta l'azienda: il controllo è qui,
-- sotto il lock della riga dell'azienda, così due scritture in parallelo non
-- passano entrambe. L'errore nomina chi ha già la matricola
-- (`matricola_taken:<nome>`) solo se chi scrive può vedere quella persona.

alter table public.member_hr add column matricola text;

CREATE OR REPLACE FUNCTION public.update_member(p_member uuid, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_m    record;
  v_hr   record;
  v_hr_keys boolean := (p_patch ? 'note') or (p_patch ? 'contract_hours') or (p_patch ? 'contract_period')
                       or (p_patch ? 'matricola');
  v_workspace uuid;
  v_matricola text;
  v_holder uuid;
begin
  select m.workspace_id into v_workspace from public.workspace_members m where m.id = p_member;
  perform private.assert_workspace_operational(v_workspace);
  if not private.can_person(p_member, 'staff') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- Chi non è titolare non decide sui propri dati di contratto.
  if v_hr_keys and private.is_restricted_self(p_member) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select m.user_id into v_m from public.workspace_members m where m.id = p_member;
  if (p_patch ? 'email') and v_m.user_id is not null then
    raise exception 'email_locked' using errcode = '23514';
  end if;

  if p_patch ? 'matricola' then
    v_matricola := nullif(btrim(coalesce(p_patch ->> 'matricola', '')), '');
    if length(v_matricola) > 30 then
      raise exception 'invalid_code' using errcode = '22023';
    end if;
    if v_matricola is not null then
      -- Il lock dell'azienda c'è già (assert_workspace_operational): qui si
      -- ripete solo per non dipendere da come è fatto quell'helper.
      perform 1 from public.workspaces w where w.id = v_workspace for update;
      select o.id into v_holder from public.member_hr h
        join public.workspace_members o on o.id = h.member_id
       where o.workspace_id = v_workspace and o.id <> p_member
         and lower(h.matricola) = lower(v_matricola)
       limit 1;
      if v_holder is not null then
        -- Si dice chi ce l'ha solo a chi può vedere quella persona: chi ha
        -- «Team» su una sede sola non scopre i nomi delle altre.
        if private.can_person(v_holder, 'staff') then
          raise exception 'matricola_taken:%',
            (select coalesce(nullif(btrim(o.display_name), ''), '')
               from public.workspace_members o where o.id = v_holder)
            using errcode = '23505';
        end if;
        raise exception 'matricola_taken' using errcode = '23505';
      end if;
    end if;
  end if;

  update public.workspace_members m set
    display_name = case when p_patch ? 'display_name'
                        then coalesce(nullif(btrim(p_patch ->> 'display_name'), ''), m.display_name)
                        else m.display_name end,
    phone = case when p_patch ? 'phone' then nullif(btrim(coalesce(p_patch ->> 'phone', '')), '') else m.phone end,
    email = case when p_patch ? 'email' then nullif(lower(btrim(coalesce(p_patch ->> 'email', ''))), '') else m.email end
  where m.id = p_member;

  if v_hr_keys then
    select h.note, h.contract_hours, h.contract_period, h.matricola into v_hr
      from public.member_hr h where h.member_id = p_member;
    insert into public.member_hr (member_id, note, contract_hours, contract_period, matricola)
    values (
      p_member,
      case when p_patch ? 'note' then nullif(btrim(coalesce(p_patch ->> 'note', '')), '') else v_hr.note end,
      case when p_patch ? 'contract_hours' then (p_patch ->> 'contract_hours')::numeric else v_hr.contract_hours end,
      case when p_patch ? 'contract_period' then p_patch ->> 'contract_period' else v_hr.contract_period end,
      case when p_patch ? 'matricola' then v_matricola else v_hr.matricola end
    )
    on conflict (member_id) do update
      set note = excluded.note, contract_hours = excluded.contract_hours,
          contract_period = excluded.contract_period, matricola = excluded.matricola;
  end if;
end;
$function$
;
