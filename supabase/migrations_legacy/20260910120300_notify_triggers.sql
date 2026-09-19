-- Performance / Disk IO — parte 4: amplificazione in scrittura.
--
-- Ogni riga inserita in `notifications` costa un INSERT + una decifratura Vault
-- + una `net.http_post` accodata (che a sua volta scrive in
-- `net.http_request_queue` e `net._http_response`). È tutto WAL, cioè scrittura
-- su disco. Annullare un turno da 10 persone significava 10 volte tutto questo,
-- dentro un'unica transazione.
--
-- Due interventi, nessun cambiamento di comportamento visibile:
--   1. i due trigger che scattavano insieme su ogni UPDATE di `shifts` diventano
--      uno, e inseriscono in blocco invece che riga per riga in un loop;
--   2. il segreto push si decifra una volta per transazione invece che per riga.

-- ---------------------------------------------------------------------------
-- 1) Un solo trigger sugli UPDATE di shifts
-- ---------------------------------------------------------------------------
-- `notify_on_shift_cancelled` (20260715150100) e `notify_on_shift_updated`
-- (20260715170100) scattavano **entrambi** su ogni UPDATE, ciascuno con il
-- proprio `if`, la propria lettura di `venues` e i propri due loop con INSERT
-- dentro. I due casi si escludono a vicenda (uno vuole status = 'cancelled',
-- l'altro status <> 'cancelled'), quindi tanto vale deciderlo una volta sola.
--
-- I destinatari e i testi sono identici a prima: staff assegnato attivo con
-- account collegato (turni interni) + candidati accettati (marketplace).
create or replace function public.notify_on_shift_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue text;
  v_type  public.notification_type;
  v_title text;
  v_body  text;
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    v_type  := 'shift_cancelled';
    v_title := 'Turno annullato';
  elsif new.status <> 'cancelled'
        and (old.date, old.start_time, old.end_time)
            is distinct from (new.date, new.start_time, new.end_time)
  then
    v_type  := 'shift_updated';
    v_title := 'Turno modificato';
  else
    return new;
  end if;

  select name into v_venue from public.venues where id = new.venue_id;

  if v_type = 'shift_cancelled' then
    v_body := coalesce(v_venue, 'Un locale') || ' ha annullato «' || new.title
      || '» del ' || to_char(new.date, 'DD/MM');
  else
    v_body := coalesce(v_venue, 'Un locale') || ' ha modificato «' || new.title
      || '»: ora ' || to_char(new.date, 'DD/MM') || ' · '
      || to_char(new.start_time, 'HH24:MI') || '–' || to_char(new.end_time, 'HH24:MI');
  end if;

  -- Un solo INSERT invece di due loop. `union` (non `union all`) copre il caso
  -- della stessa persona sia assegnata sia candidata accettata: prima avrebbe
  -- ricevuto due notifiche identiche.
  insert into public.notifications (user_id, type, title, body, related_id)
  select w, v_type, v_title, v_body, new.id
  from (
    select sm.waiter_id as w
    from public.shift_assignments a
    join public.staff_members sm on sm.id = a.staff_member_id
    where a.shift_id = new.id
      and a.status in ('assigned', 'confirmed')
      and sm.waiter_id is not null
    union
    select ap.waiter_id
    from public.applications ap
    where ap.shift_id = new.id
      and ap.status = 'accepted'
  ) recipients;

  return new;
end;
$$;

revoke execute on function public.notify_on_shift_change() from anon, authenticated, public;

drop trigger if exists shifts_notify_cancelled on public.shifts;
drop trigger if exists shifts_notify_updated   on public.shifts;

drop trigger if exists shifts_notify_change on public.shifts;
create trigger shifts_notify_change
  after update on public.shifts
  for each row execute function public.notify_on_shift_change();

-- Le vecchie funzioni non sono più agganciate a nulla.
drop function if exists public.notify_on_shift_cancelled();
drop function if exists public.notify_on_shift_updated();

-- ---------------------------------------------------------------------------
-- 2) Il segreto push si decifra una volta per transazione
-- ---------------------------------------------------------------------------
-- `vault.decrypted_secrets` è una vista che **decifra a ogni lettura**: non c'è
-- cache. Il trigger la interrogava per ogni riga di `notifications`, quindi una
-- cancellazione con dieci destinatari faceva dieci decifrature.
--
-- `set_config(..., is_local := true)` mette il valore nella transazione
-- corrente: le righe successive dello stesso statement lo trovano già lì, e a
-- fine transazione sparisce da sé.
--
-- Il resto della funzione è identico a 20260716120000: stesso filtro sulle
-- preferenze, stessa chiamata, stesso payload.
create or replace function public.notify_push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cached text;
  v_secret text;
  v_muted  boolean;
begin
  -- NULL = non ancora cercato in questa transazione; '' = cercato e assente.
  v_cached := current_setting('topwaitr.push_secret', true);
  if v_cached is null then
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
      where name = 'push_hook_secret'
      limit 1;
    perform set_config('topwaitr.push_secret', coalesce(v_secret, ''), true);
  else
    v_secret := nullif(v_cached, '');
  end if;

  if v_secret is null then
    return new;
  end if;

  -- Preferenza utente: salta la push se la categoria è disattivata (l'in-app resta).
  select coalesce(
           (p.notification_prefs ->> public.notification_category(new.type)) = 'false',
           false
         )
    into v_muted
    from public.profiles p
    where p.id = new.user_id;

  if v_muted then
    return new;
  end if;

  perform net.http_post(
    url     := 'https://rmlobxjlqlpixkvrzmfg.supabase.co/functions/v1/push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', v_secret
    ),
    body    := jsonb_build_object(
      'notification_id', new.id,
      'user_id',         new.user_id,
      'type',            new.type,
      'title',           new.title,
      'body',            new.body,
      'related_id',      new.related_id
    )
  );

  return new;
end;
$$;

revoke execute on function public.notify_push_on_notification() from anon, authenticated, public;
