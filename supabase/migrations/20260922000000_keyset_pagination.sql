-- Paginazione degli insiemi che crescono nel tempo.
--
-- I cursori usano sempre un ordine totale (data, id): una riga inserita mentre
-- si scorre non sposta quelle già viste, come accadrebbe con OFFSET.

-- Ultime notifiche di un account, ordinate in modo deterministico.
drop index public.notifications_user_idx;
create index notifications_user_created_id_idx
  on public.notifications (user_id, created_at desc, id desc);
create index notifications_user_unread_idx
  on public.notifications (user_id) where read_at is null;

-- Storico assenze di una persona.
drop index public.staff_absences_member_idx;
create index staff_absences_member_start_id_idx
  on public.staff_absences (member_id, start_date desc, id desc);
create index staff_absences_status_end_idx
  on public.staff_absences (status, end_date);

-- Il prefisso (venue_id, date) continua a servire calendari e intervalli; ora
-- anche il resto dell'ordine dello storico è coperto dall'indice.
drop index public.shifts_venue_date_idx;
create index shifts_venue_date_time_id_idx
  on public.shifts (venue_id, date desc, start_time desc, id desc);

drop index public.messages_conversation_idx;
create index messages_conversation_created_id_idx
  on public.messages (conversation_id, created_at desc, id desc);

-- La data dell'ultimo messaggio rende paginabile la lista dei thread. Non si
-- può derivare e ordinare lato client: a quel punto avremmo già scaricato tutte
-- le conversazioni.
alter table public.conversations add column last_message_at timestamptz;

update public.conversations c
   set last_message_at = x.last_message_at
  from (
    select conversation_id, max(created_at) as last_message_at
      from public.messages
     group by conversation_id
  ) x
 where x.conversation_id = c.id;

create index conversations_user_a_activity_idx
  on public.conversations (user_a, last_message_at desc, id desc)
  where last_message_at is not null;
create index conversations_user_b_activity_idx
  on public.conversations (user_b, last_message_at desc, id desc)
  where last_message_at is not null;

create function private.touch_conversation_on_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.conversations
     set last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at)
   where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function private.touch_conversation_on_message();

-- Versione keyset dello storico del professionista. La funzione precedente
-- resta disponibile per compatibilità, ma i client nuovi non usano OFFSET.
create function public.get_my_work_history_page(
  p_limit integer default 20,
  p_before_date date default null,
  p_before_key text default null
)
returns table (
  key text, venue_name text, logo_url text, title text, date date,
  start_time time, end_time time, hours numeric
) language sql stable security definer set search_path = '' as $$
  select h.* from private.my_work_history((select auth.uid())) h
   where p_before_date is null
      or (h.date, h.key) < (p_before_date, p_before_key)
   order by h.date desc, h.key desc
   limit greatest(p_limit, 0);
$$;

grant execute on function public.get_my_work_history_page(integer, date, text)
to authenticated;
