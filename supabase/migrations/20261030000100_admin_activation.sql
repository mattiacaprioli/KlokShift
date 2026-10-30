-- Attivazione delle aziende, per il fondatore (piano del 30/10, Fase 5).
--
-- Per ogni azienda: quando è nata, quando ha aperto la prima sede e avviato la
-- prova, quante persone lavorano nel team, quante hanno un'email o un account
-- collegato, quando è stato creato il primo turno e quando qualcuno ha
-- confermato per la prima volta. Serve a vedere dove le aziende si fermano
-- (registrazione → prova → persone → primo turno) invece di indovinarlo.
--
-- Solo date e conteggi (FOUNDER-DASHBOARD.md, «Date e storico»): nessun nome di
-- persona, nessuna scheda HR, nessun contenuto di turni o chat. Le date sono
-- quelle registrate dalle righe stesse (`created_at`, `confirmed_at`): niente
-- ricostruzioni. Il primo turno è il primo **pianificato**: un fuori turno o un
-- turno registrato a posteriori non dice che il titolare ha imparato a
-- pianificare.
create function public.admin_list_activation(p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.require_platform_admin();
  perform private.validate_admin_page('', 25, p_offset);
  with base as materialized (
    select r.id, r.name, r.created_at, r.classification, r.state
      from private.admin_workspace_rows r
     where r.state <> 'deleted'),
  team as (
    select m.workspace_id,
           count(*) as people,
           count(*) filter (where m.email is not null or m.user_id is not null) as with_email,
           count(*) filter (where m.user_id is not null and m.status = 'active') as linked
      from public.workspace_members m
     where m.status <> 'left'
       and exists (select 1 from public.venue_members vm where vm.member_id = m.id and vm.left_at is null)
     group by m.workspace_id)
  select jsonb_build_object('generated_at', now(), 'total', (select count(*) from base),
    'limit', 25, 'offset', p_offset,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'workspace_id', b.id, 'workspace_name', b.name, 'classification', b.classification,
        'state', b.state, 'created_at', b.created_at,
        'first_venue_at', (select min(v.created_at) from public.venues v where v.workspace_id = b.id),
        'trial_started_at', (select c.trial_started_at from public.workspace_commercial_state c where c.workspace_id = b.id),
        'people', coalesce(t.people, 0), 'with_email', coalesce(t.with_email, 0), 'linked', coalesce(t.linked, 0),
        'first_shift_at', (select min(s.created_at) from public.shifts s join public.venues v on v.id = s.venue_id
                            where v.workspace_id = b.id and not s.unplanned and s.recorded_at is null),
        'first_confirmed_at', (select min(a.confirmed_at) from public.shift_assignments a
                                 join public.shifts s on s.id = a.shift_id join public.venues v on v.id = s.venue_id
                                where v.workspace_id = b.id))
        order by b.created_at desc, b.id), '[]'::jsonb)
      from (select * from base order by created_at desc, id limit 25 offset p_offset) b
      left join team t on t.workspace_id = b.id))
  into result;
  return result;
end;
$$;

revoke all on function public.admin_list_activation(integer) from public, anon, authenticated;
grant execute on function public.admin_list_activation(integer) to authenticated;
