-- Promemoria delle bozze (bozza e pubblicazione dei turni, parte 4).
--
-- Una bozza dimenticata è un turno che il team non vede. Ogni ora
-- `private.run_draft_reminders` avvisa chi gestisce i turni di una sede che ci
-- sono bozze in partenza nelle prossime 24 ore: una sola notifica per sede, non
-- una per turno. `private.draft_reminders` impedisce che lo stesso turno sia
-- ricordato due volte. Salta le aziende che il promemoria di timbratura salta
-- (archivio o sola lettura: non si pubblica).

create table private.draft_reminders (
  shift_id uuid primary key references public.shifts on delete cascade,
  sent_at  timestamptz not null default now()
);
create index draft_reminders_sent_idx on private.draft_reminders (sent_at);
revoke all on private.draft_reminders from public, anon, authenticated;

create function private.queue_draft_reminders(p_at timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_now   timestamp := p_at at time zone 'Europe/Rome';
  v       record;
  v_name  text;
  v_title text;
  v_start timestamp;
  v_first uuid;
  v_user  uuid;
  v_count integer := 0;
begin
  for v in
    with candidates as (
      select s.id, s.venue_id, s.title, s.date + s.start_time as starts_at, ve.workspace_id
        from public.shifts s
        join public.venues ve on ve.id = s.venue_id
       where s.published_at is null
         and s.status <> 'cancelled'
         and s.date between v_now::date and v_now::date + 1
         and s.date + s.start_time > v_now
         and s.date + s.start_time <= v_now + interval '24 hours'
         and not exists (select 1 from private.draft_reminders d where d.shift_id = s.id)
    ), operational as (
      select w.workspace_id
        from (select distinct workspace_id from candidates) w
        cross join lateral (select private.workspace_access_at(w.workspace_id, p_at) as a) x
       where x.a ->> 'state' = 'migration_pending'
          or coalesce((x.a ->> 'can_operate')::boolean, false)
    ), claimed as (
      -- Si prenotano prima i turni: due esecuzioni sovrapposte non avvisano due volte.
      insert into private.draft_reminders (shift_id)
      select c.id from candidates c
        join operational o on o.workspace_id = c.workspace_id
      on conflict do nothing
      returning shift_id
    )
    select c.venue_id, array_agg(c.id order by c.starts_at, c.id) as ids
      from candidates c
      join claimed k on k.shift_id = c.id
     group by c.venue_id
  loop
    select ve.name into v_name from public.venues ve where ve.id = v.venue_id;
    v_first := v.ids[1];
    if cardinality(v.ids) = 1 then
      select s.title, s.date + s.start_time into v_title, v_start
        from public.shifts s where s.id = v_first;
    end if;

    for v_user in select distinct private.managers_of(v.venue_id, 'shifts') loop
      perform private.notify(v_user, 'shift_drafts_reminder', 'Turni da pubblicare',
        case when cardinality(v.ids) = 1
          then v_name || ': «' || v_title || '» del ' || to_char(v_start, 'DD/MM')
               || ' alle ' || to_char(v_start, 'HH24:MI') || ' non è ancora pubblicato. Il team non lo vede.'
          else v_name || ': ' || cardinality(v.ids)
               || ' turni delle prossime 24 ore non sono ancora pubblicati. Il team non li vede.'
        end,
        v_first);
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;

create function private.run_draft_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  v_count := private.queue_draft_reminders(now());
  delete from private.draft_reminders where sent_at < now() - interval '3 days';
  return v_count;
end;
$$;

revoke all on function private.queue_draft_reminders(timestamptz),
  private.run_draft_reminders() from public, anon, authenticated;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('draft-reminders', '15 * * * *', 'select private.run_draft_reminders()');
exception when others then
  raise notice 'pg_cron non disponibile: promemoria delle bozze non programmati (%).', sqlerrm;
end $$;
