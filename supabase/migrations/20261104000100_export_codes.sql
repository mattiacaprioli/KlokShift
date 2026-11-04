-- Codici per il consulente (2026-11-04).
--
-- Il consulente importa le ore nel suo programma paghe, dove l'azienda ha un
-- codice e ogni voce (lavoro, ferie, permesso, malattia) ne ha un altro. Li
-- scrive chi ha «Ore», copiandoli da quel che gli dà il consulente, come fanno
-- Fluida e Planday; finiscono nei CSV della pagina Ore.
--
-- Chiave e valore, non una colonna per causale: col punto 3 (maggiorazioni)
-- arriveranno altre chiavi senza toccare lo schema, solo il check qui sotto e
-- `save_export_codes`.
--
-- `get_export_codes` è la sola fonte dell'export per codici e matricole. Le
-- matricole stanno in member_hr, che chi ha «Ore» senza «Team» non legge: qui le
-- riceve lo stesso, nel perimetro delle sue ore (le stesse persone del
-- riepilogo assenze), perché senza non potrebbe fare l'export per cui ha il
-- permesso. È un codice per il programma paghe, non un dato riservato come la
-- nota HR.

create table public.workspace_export_codes (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key text not null check (key in ('company', 'work', 'ferie', 'permesso', 'malattia')),
  code text not null check (length(code) between 1 and 20),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, key)
);
-- Solo RPC: nessuna policy, nessun grant.
alter table public.workspace_export_codes enable row level security;

-- «Ore» sull'azienda: il titolare, o chi ha «Ore» su almeno una sua sede.
create function private.can_workspace_hours(p_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_workspace in (select private.my_workspace_ids('owner'))
      or exists (select 1 from public.venues v
                  where v.workspace_id = p_workspace
                    and v.id in (select private.venues_where('hours')));
$$;
revoke all on function private.can_workspace_hours(uuid) from public, anon, authenticated;

create function public.save_export_codes(p_workspace uuid, p_codes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
  v_code text;
begin
  perform private.assert_workspace_operational(p_workspace);
  if not private.can_workspace_hours(p_workspace) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_codes, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_code' using errcode = '22023';
  end if;
  for v_key, v_code in select k, btrim(coalesce(v #>> '{}', '')) from jsonb_each(coalesce(p_codes, '{}'::jsonb)) as e(k, v) loop
    if v_key not in ('company', 'work', 'ferie', 'permesso', 'malattia') or length(v_code) > 20 then
      raise exception 'invalid_code' using errcode = '22023';
    end if;
  end loop;

  -- Il salvataggio sostituisce l'insieme: una chiave assente o vuota sparisce.
  delete from public.workspace_export_codes c where c.workspace_id = p_workspace;
  insert into public.workspace_export_codes (workspace_id, key, code)
  select p_workspace, e.k, btrim(e.v #>> '{}')
    from jsonb_each(coalesce(p_codes, '{}'::jsonb)) as e(k, v)
   where btrim(coalesce(e.v #>> '{}', '')) <> '';
end;
$$;

create function public.get_export_codes(p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_workspace_hours(p_workspace)
     or p_workspace not in (select private.commercial_readable_workspace_ids()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'codes', coalesce((select jsonb_object_agg(c.key, c.code)
                         from public.workspace_export_codes c
                        where c.workspace_id = p_workspace), '{}'::jsonb),
    'matricole', coalesce((
      select jsonb_agg(jsonb_build_object('member_id', m.id, 'matricola', h.matricola) order by m.id)
        from public.workspace_members m
        join public.member_hr h on h.member_id = m.id
       where m.workspace_id = p_workspace and h.matricola is not null
         and (p_workspace in (select private.my_workspace_ids('owner'))
           or exists (select 1 from public.venue_members vm
                       where vm.member_id = m.id
                         and vm.venue_id in (select private.venues_where('hours'))))
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.save_export_codes(uuid, jsonb), public.get_export_codes(uuid)
  from public, anon;
grant execute on function public.save_export_codes(uuid, jsonb), public.get_export_codes(uuid)
  to authenticated;
