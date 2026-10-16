-- Modelli di turno: un turno tipo («Cena», «Pranzo sala») da cui ripartire
-- senza riscrivere orari, pausa, fabbisogno e note. Decisione in
-- plans/SHIFT-TEMPLATES.md.
--
-- Per sede, perché il fabbisogno nomina `venue_roles` di quella sede. Niente
-- data e niente persone: cambiano da un giorno all'altro, e una persona uscita
-- dall'organico non deve rientrare in un turno da un modello vecchio. Li legge e
-- li scrive chi ha «Turni» sulla sede; le scritture passano dalle RPC.

create table public.shift_templates (
  id                   uuid primary key default gen_random_uuid(),
  venue_id             uuid not null references public.venues (id) on delete cascade,
  name                 text not null check (char_length(btrim(name)) between 1 and 60),
  start_time           time not null,
  end_time             time not null,
  break_minutes        integer not null default 0 check (break_minutes between 0 and 240),
  description          text,
  require_confirmation boolean not null default false,
  -- [{role_id, count}] con count 1..99 (il tetto del campo sulla dashboard).
  -- I ruoli archiviati restano qui e li scarta chi applica il modello: il
  -- modello è un precompilato, non un vincolo.
  role_targets         jsonb not null default '[]'::jsonb
                         check (jsonb_typeof(role_targets) = 'array'),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Un nome per sede, senza distinguere maiuscole e spazi: risalvare «cena»
-- aggiorna «Cena» invece di affiancargli un doppione.
create unique index shift_templates_venue_name_key
  on public.shift_templates (venue_id, lower(btrim(name)));

alter table public.shift_templates enable row level security;
grant select on public.shift_templates to authenticated;

create policy "shift_templates: shift managers read" on public.shift_templates
  for select to authenticated
  using (venue_id in (select private.venues_where('shifts')));

create policy "commercial archive read" on public.shift_templates as restrictive
  for select to authenticated
  using (venue_id in (select private.commercial_readable_venue_ids()));

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------
-- p_template: {name, start_time, end_time, break_minutes?, description?,
--              require_confirmation?, role_targets?[{role_id, count}]}
-- Stesso nome nella sede → aggiorna quel modello (stesso id). Al massimo 30
-- modelli per sede: oltre, una riga di chip non si legge più.
create function public.save_shift_template(p_venue uuid, p_template jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_name    text := btrim(coalesce(p_template ->> 'name', ''));
  v_start   time;
  v_end     time;
  v_break   integer;
  v_targets jsonb := '[]'::jsonb;
  v_target  jsonb;
  v_count   integer;
  v_id      uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  perform private.assert_workspace_operational(private.venue_workspace(p_venue));
  if p_venue is null or not private.can(p_venue, 'shifts') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'name_required' using errcode = '23514';
  end if;
  -- Le conversioni dopo i controlli d'accesso: un orario malformato non deve
  -- rispondere prima di «non puoi».
  v_start := (p_template ->> 'start_time')::time;
  v_end := (p_template ->> 'end_time')::time;
  v_break := coalesce((p_template ->> 'break_minutes')::integer, 0);
  if v_start is null or v_end is null or v_start = v_end
     or char_length(v_name) > 60
     or jsonb_typeof(coalesce(p_template -> 'role_targets', '[]'::jsonb)) <> 'array' then
    raise exception 'template_invalid' using errcode = '22023';
  end if;
  perform private.assert_shift_break(v_start, v_end, v_break);

  for v_target in select * from jsonb_array_elements(coalesce(p_template -> 'role_targets', '[]'::jsonb)) loop
    v_count := coalesce((v_target ->> 'count')::integer, 0);
    if v_count > 0 then
      if v_count > 99 or (v_target ->> 'role_id') is null then
        raise exception 'template_invalid' using errcode = '22023';
      end if;
      perform private.assert_role_in_venue((v_target ->> 'role_id')::uuid, p_venue);
      v_targets := v_targets || jsonb_build_array(jsonb_build_object(
        'role_id', (v_target ->> 'role_id')::uuid, 'count', v_count));
    end if;
  end loop;

  select t.id into v_id from public.shift_templates t
   where t.venue_id = p_venue and lower(btrim(t.name)) = lower(v_name)
   for update;

  if v_id is not null then
    update public.shift_templates set
      name = v_name,
      start_time = v_start,
      end_time = v_end,
      break_minutes = v_break,
      description = nullif(btrim(coalesce(p_template ->> 'description', '')), ''),
      require_confirmation = coalesce((p_template ->> 'require_confirmation')::boolean, false),
      role_targets = v_targets,
      updated_at = now()
     where id = v_id;
    return v_id;
  end if;

  if (select count(*) from public.shift_templates t where t.venue_id = p_venue) >= 30 then
    raise exception 'template_limit' using errcode = '23514';
  end if;
  insert into public.shift_templates (
    venue_id, name, start_time, end_time, break_minutes, description,
    require_confirmation, role_targets
  ) values (
    p_venue, v_name, v_start, v_end, v_break,
    nullif(btrim(coalesce(p_template ->> 'description', '')), ''),
    coalesce((p_template ->> 'require_confirmation')::boolean, false),
    v_targets
  ) returning id into v_id;
  return v_id;
end;
$$;

-- Eliminare un modello non tocca i turni nati da lui: sono copie, non legami.
create function public.delete_shift_template(p_template uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_venue uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select t.venue_id into v_venue from public.shift_templates t where t.id = p_template;
  -- Modello inesistente o di un'altra azienda: lo stesso errore, per non dire
  -- a chi non può vederlo che esiste.
  if v_venue is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.assert_workspace_operational(private.venue_workspace(v_venue));
  if not private.can(v_venue, 'shifts') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  delete from public.shift_templates where id = p_template;
end;
$$;

grant execute on function
  public.save_shift_template(uuid, jsonb),
  public.delete_shift_template(uuid)
to authenticated;
