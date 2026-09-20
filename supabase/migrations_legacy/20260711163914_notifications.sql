-- Crea notifiche in-app sugli eventi di candidatura. SECURITY DEFINER perché la
-- RLS 'notifications: own only' vieta al client di inserire per un altro utente
-- (stesso pattern di sync_positions_filled / sync_waiter_rating).
create or replace function public.notify_on_application()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title  text;
  v_owner  uuid;
  v_venue  text;
  v_waiter text;
begin
  if (tg_op = 'INSERT') then
    -- Notifica al ristoratore: nuova candidatura ricevuta.
    select s.title, ve.owner_id, ve.name
      into v_title, v_owner, v_venue
      from public.shifts s
      join public.venues ve on ve.id = s.venue_id
      where s.id = new.shift_id;
    select full_name into v_waiter from public.profiles where id = new.waiter_id;

    if v_owner is not null then
      insert into public.notifications (user_id, type, title, body, related_id)
      values (
        v_owner, 'application_received', 'Nuova candidatura',
        coalesce(v_waiter, 'Un cameriere') || ' si è candidato per «' || v_title || '»',
        new.shift_id
      );
    end if;
    return new;
  end if;

  if (tg_op = 'UPDATE'
      and new.status is distinct from old.status
      and new.status in ('accepted', 'rejected')) then
    -- Notifica al cameriere: esito della candidatura.
    select s.title, ve.name into v_title, v_venue
      from public.shifts s
      join public.venues ve on ve.id = s.venue_id
      where s.id = new.shift_id;

    insert into public.notifications (user_id, type, title, body, related_id)
    values (
      new.waiter_id,
      case when new.status = 'accepted' then 'application_accepted'::public.notification_type
           else 'application_rejected'::public.notification_type end,
      case when new.status = 'accepted' then 'Candidatura accettata'
           else 'Candidatura non accettata' end,
      case when new.status = 'accepted'
           then 'Sei stato accettato per «' || v_title || '» da ' || v_venue
           else 'La tua candidatura per «' || v_title || '» non è stata accettata' end,
      new.shift_id
    );
    return new;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists applications_notify on public.applications;
create trigger applications_notify
  after insert or update on public.applications
  for each row execute function public.notify_on_application();

-- Funzione di trigger: non va esposta come RPC SECURITY DEFINER.
revoke execute on function public.notify_on_application() from anon, authenticated, public;

-- Realtime per aggiornare badge e toast in tempo reale. Idempotente: la tabella
-- potrebbe già essere nella publication (abilitata in setup, non via migration).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
