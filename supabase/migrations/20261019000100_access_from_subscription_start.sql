-- «Inizio accesso» di un abbonamento: dall'acquisto, non dall'ultimo avviso.
--
-- `billing_sync_periods` chiude il periodo e ne apre uno nuovo a ogni aumento,
-- rinnovo o tolleranza: è giusto per la storia della capacità, ma
-- `operational_from` mostrava l'istante dell'ultimo cambio (prova sandbox del
-- 18/10: 16:44 invece delle 13:02 dell'acquisto). Ora risale ai periodi
-- contigui dello stesso abbonamento. Il valore è solo informativo: nessun
-- diritto ne dipende, e limiti, piano e termini restano quelli del periodo
-- corrente.
--
-- Copia integrale di 20261018000000_billing_subscriptions.sql §6 con la sola
-- risalita aggiunta dopo la scelta del periodo.
create or replace function private.workspace_access_at(p_workspace uuid, p_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_period record;
  v_state text := 'setup';
  v_source text;
  v_plan text;
  v_from timestamptz;
  v_prev timestamptz;
  v_until timestamptz;
  v_archive_until timestamptz;
  v_attendance_until timestamptz;
  v_venue_limit integer;
  v_people_limit integer;
  v_people bigint := 0;
  v_venues bigint := 0;
  v_deleted boolean;
  v_migration_pending boolean := false;
begin
  if p_at is null or not isfinite(p_at) then
    raise exception 'invalid_access_period' using errcode = '23514';
  end if;

  select w.deleted_at is not null into v_deleted
    from public.workspaces w where w.id = p_workspace;
  if not found or v_deleted then
    v_state := 'expired';
  else
    select count(*) into v_venues
      from public.venues v
     where v.workspace_id = p_workspace and v.closed_at is null;
    select count(distinct m.id) into v_people
      from public.workspace_members m
      join public.venue_members vm on vm.member_id = m.id
      join public.venues v on v.id = vm.venue_id
     where m.workspace_id = p_workspace
       and m.status in ('active', 'invited')
       and vm.left_at is null and v.closed_at is null;

    select s.migration_review_required into v_migration_pending
      from public.workspace_commercial_state s where s.workspace_id = p_workspace;

    -- Prima un periodo operativo. Una concessione permanente operativa prevale,
    -- poi un abbonamento operativo; altrimenti vince il termine effettivo più
    -- lontano. Se sono tutti terminati, si usa l'ultimo termine effettivo, senza
    -- sommare capacità di periodi diversi. Una revoca prima dell'inizio non crea
    -- un periodo operativo né un archivio.
    with effective_periods as (
      select p.*,
             case
               when p.revoked_at is null then p.ends_at
               when p.ends_at is null then p.revoked_at
               else least(p.ends_at, p.revoked_at)
             end as effective_end
        from public.workspace_access_periods p
       where p.workspace_id = p_workspace and p.starts_at <= p_at
    )
    select p.* into v_period
      from effective_periods p
     where p.effective_end is null or p.effective_end > p.starts_at
     order by (p.effective_end is null or p_at < p.effective_end) desc,
              (p.kind = 'complimentary_lifetime'
                and (p.effective_end is null or p_at < p.effective_end)) desc,
              (p.kind in ('subscription', 'payment_grace')
                and (p.effective_end is null or p_at < p.effective_end)) desc,
              p.effective_end desc nulls first,
              p.starts_at desc, p.created_at desc, p.id desc
     limit 1;

    if found then
      v_source := v_period.kind;
      v_plan := v_period.plan;
      v_from := v_period.starts_at;
      v_until := v_period.effective_end;
      v_venue_limit := v_period.venue_limit;
      v_people_limit := case when v_plan = 'base' then 30 else null end;

      -- Stesso abbonamento senza interruzioni (aumento, rinnovo, tolleranza):
      -- l'inizio è quello del primo tratto. Una ripresa dopo un vuoto no.
      if v_period.subscription_id is not null then
        loop
          select p.starts_at into v_prev
            from public.workspace_access_periods p
           where p.subscription_id = v_period.subscription_id
             and p.kind in ('subscription', 'payment_grace')
             and p.starts_at < v_from
             and (p.revoked_at is null or p.revoked_at > p.starts_at)
             and least(coalesce(p.revoked_at, p.ends_at), coalesce(p.ends_at, p.revoked_at)) >= v_from
           order by p.starts_at
           limit 1;
          exit when not found;
          v_from := v_prev;
        end loop;
      end if;

      if v_until is not null then
        -- Dodici mesi di calendario nell'ora italiana, indipendenti dalla TZ
        -- della connessione, compresi anno bisestile e cambi di ora legale.
        v_archive_until := (
          (v_until at time zone 'Europe/Rome') + interval '12 months'
        ) at time zone 'Europe/Rome';
        -- Finestra di rettifica distinta: sette giorni, non un'altra concessione.
        v_attendance_until := v_until + interval '168 hours';
      end if;

      if v_until is null or p_at < v_until then
        v_state := 'operational';
      elsif p_at < v_archive_until then
        v_state := 'archive';
      else
        v_state := 'expired';
      end if;
    elsif coalesce(v_migration_pending, false) then
      v_state := 'migration_pending';
    end if;
  end if;

  return jsonb_build_object(
    'workspace_id', p_workspace,
    'server_now', p_at,
    'next_change_at', (select min(p.starts_at) from public.workspace_access_periods p
      where p.workspace_id = p_workspace and p.starts_at > p_at
        and (p.revoked_at is null or p.revoked_at > p.starts_at)),
    'state', v_state,
    'source', v_source,
    'plan', v_plan,
    'operational_from', v_from,
    'operational_until', v_until,
    'archive_until', v_archive_until,
    'attendance_until', v_attendance_until,
    'can_operate', v_state = 'operational',
    'can_read', v_state <> 'expired',
    'can_complete_attendance', v_state = 'operational'
      or (v_state = 'archive' and p_at < v_attendance_until),
    'limits', jsonb_build_object('people', v_people_limit, 'venues', v_venue_limit),
    'usage', jsonb_build_object('people', v_people, 'venues', v_venues)
  );
end;
$$;
revoke all on function private.workspace_access_at(uuid, timestamptz)
  from public, anon, authenticated;
