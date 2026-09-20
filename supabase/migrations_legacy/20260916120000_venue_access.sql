-- Collaboratori del titolare: accesso delegato a una sede, con permessi.
--
-- Il caso: un locale in cui due persone organizzano i turni. Finora l'unica
-- strada era passarsi le credenziali dell'unico account — nessuna tracciabilità,
-- nessun limite, e chi gestisce il bar vede anche il ristorante.
--
-- `venue_access` è una riga per (sede, persona): il titolare sceglie **su quali
-- sedi** fa entrare qualcuno e **cosa può fare**. Il titolare non ha righe qui:
-- `venues.owner_id` resta la fonte di verità del "può tutto", e questa tabella
-- non deve mai poter dare a nessuno più di quello.

-- ---------------------------------------------------------------------------
-- 1. La tabella
-- ---------------------------------------------------------------------------
-- La unique su `venues` serve alla FK composita qui sotto: senza, non si può
-- puntare a (id, owner_id) e `venue_access.owner_id` sarebbe una copia che
-- nessuno controlla.
alter table public.venues
  drop constraint if exists venues_id_owner_uq;
alter table public.venues
  add constraint venues_id_owner_uq unique (id, owner_id);

create table if not exists public.venue_access (
  id        uuid primary key default gen_random_uuid(),
  venue_id  uuid not null references public.venues(id) on delete cascade,
  -- Denormalizzato di proposito: è il perimetro dell'azienda, e senza di esso
  -- ogni controllo ("questo delegato è di un'altra azienda?") diventa un join.
  -- La FK composita lo tiene onesto: non può divergere da `venues.owner_id`.
  owner_id  uuid not null,
  -- Null finché la persona non si registra: l'invito esiste prima dell'account,
  -- esattamente come per l'organico (20260916100000).
  user_id   uuid references public.profiles(id) on delete cascade,
  email     text,
  status    text not null default 'pending',

  can_manage_shifts    boolean not null default true,
  can_manage_staff     boolean not null default false,
  can_view_hours       boolean not null default false,
  can_manage_documents boolean not null default false,
  can_manage_venue     boolean not null default false,

  invited_at   timestamptz,
  invite_count integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint venue_access_venue_owner_fk
    foreign key (venue_id, owner_id) references public.venues(id, owner_id)
    on update cascade on delete cascade,
  constraint venue_access_status_ck
    check (status in ('pending', 'active', 'revoked')),
  -- Una riga senza né account né indirizzo non è invitabile né collegabile:
  -- sarebbe solo un permesso appeso a nessuno.
  constraint venue_access_user_or_email_ck
    check (user_id is not null or email is not null),
  -- Il titolare non si delega a se stesso: avrebbe già tutto, e una riga così
  -- sarebbe l'unico modo per vedersi comparire dei permessi *minori* dei propri.
  constraint venue_access_not_self_ck
    check (user_id is null or user_id <> owner_id),
  constraint venue_access_email_format_ck
    check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

-- Una persona sola per sede, sia per account sia per indirizzo: due righe per lo
-- stesso collaboratore vorrebbero dire due insiemi di permessi, e nessuno dei
-- due sarebbe quello vero.
create unique index if not exists venue_access_venue_user_uq
  on public.venue_access (venue_id, user_id) where user_id is not null;
create unique index if not exists venue_access_venue_email_uq
  on public.venue_access (venue_id, lower(email)) where email is not null;

-- ⚠️ Questo indice non è un'ottimizzazione: `my_venue_ids()` gira dentro OGNI
-- policy di turni, organico e ruoli. Senza, ogni statement fa un seq scan su
-- questa tabella — su un progetto che il disk IO l'ha già finito una volta.
create index if not exists venue_access_user_active_idx
  on public.venue_access (user_id) where user_id is not null and status = 'active';
create index if not exists venue_access_owner_idx
  on public.venue_access (owner_id);
-- L'aggancio alla registrazione cerca per indirizzo fra gli inviti non ancora
-- collegati: stessa forma di `staff_people_pending_email_idx`.
create index if not exists venue_access_pending_email_idx
  on public.venue_access (lower(email)) where email is not null and user_id is null;

-- ---------------------------------------------------------------------------
-- 2. Un delegato, una sola azienda
-- ---------------------------------------------------------------------------
-- Vincolo di questa iterazione, non una legge di prodotto: il provider lato app
-- espone **un** `ownerId` (è il perimetro di organico, ore ed export), e due
-- aziende insieme vorrebbero dire uno switcher e una revisione di ogni query
-- scopata per azienda. Meglio rifiutare qui, dove si vede, che scoprirlo in una
-- schermata che mostra le ore di due datori di lavoro sommate.
--
-- Non esprimibile come CHECK (guarda altre righe) né come unique (il vincolo è
-- "un solo owner_id distinto per user_id").
create or replace function public.venue_access_one_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not null and new.status <> 'revoked' then
    -- Delegato di due aziende diverse.
    if exists (
      select 1 from public.venue_access a
       where a.user_id  = new.user_id
         and a.owner_id <> new.owner_id
         and a.status   <> 'revoked'
         and a.id       <> new.id
    ) then
      raise exception 'already_in_other_company';
    end if;
    -- Titolare di sedi proprie **e** delegato altrove: stesso problema visto
    -- dall'altro lato. Le sue sedi e quelle delegate finirebbero nella stessa
    -- lista, e le ore di due datori di lavoro nello stesso export.
    if exists (
      select 1 from public.venues v where v.owner_id = new.user_id
    ) then
      raise exception 'already_owns_venues';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.venue_access_one_company() from anon, authenticated, public;

drop trigger if exists venue_access_one_company on public.venue_access;
create trigger venue_access_one_company
  before insert or update on public.venue_access
  for each row execute function public.venue_access_one_company();

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table public.venue_access enable row level security;

-- Il titolare gestisce i propri collaboratori. `owner_id = auth.uid()` basta da
-- solo: la FK composita garantisce già che la sede sia sua.
drop policy if exists "venue_access: owner all" on public.venue_access;
create policy "venue_access: owner all"
  on public.venue_access for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Il delegato legge **solo le proprie righe**, e non ne scrive nessuna: i suoi
-- permessi sono un dato del titolare, non un campo del suo profilo. Senza questa
-- policy l'app non saprebbe cosa mostrargli.
--
-- ⚠️ Non vede i colleghi delegati: sapere chi altro ha accesso alla sede è
-- un'informazione del titolare.
drop policy if exists "venue_access: delegate reads own" on public.venue_access;
create policy "venue_access: delegate reads own"
  on public.venue_access for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Il nome e la foto dei propri collaboratori.
--
-- Senza questa riga la lista mostrerebbe solo indirizzi email: `profiles` è
-- chiuso, e le due deroghe che esistono (il candidato di un turno, la persona
-- del proprio organico) valgono per i professionisti. Un collaboratore è un
-- account `manager`, quindi non passa da nessuna delle due.
--
-- Solo mentre l'accesso è vivo: dopo una revoca il titolare torna a vedere
-- l'indirizzo che ha scritto lui, che è tutto ciò che gli serve.
drop policy if exists "profiles: owner reads delegates" on public.profiles;
create policy "profiles: owner reads delegates"
  on public.profiles for select
  to authenticated
  using (
    exists (
      select 1 from public.venue_access a
       where a.user_id  = profiles.id
         and a.owner_id = (select auth.uid())
         and a.status  <> 'revoked'
    )
  );

-- E il contrario: il collaboratore vede il nome del titolare, che è il mittente
-- di ogni invito e la firma di tutto ciò che trova dentro.
drop policy if exists "profiles: delegate reads owner" on public.profiles;
create policy "profiles: delegate reads owner"
  on public.profiles for select
  to authenticated
  using (
    exists (
      select 1 from public.venue_access a
       where a.owner_id = profiles.id
         and a.user_id  = (select auth.uid())
         and a.status   = 'active'
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Il perimetro, esteso ai delegati
-- ---------------------------------------------------------------------------
-- Questo è il punto di tutta la migration precedente: le venti policy riscritte
-- in 20260916110000 non si toccano più. Cambia solo cosa risponde questa
-- funzione.
--
-- `union` e non `union all`: chi è titolare di una sede e delegato sulla stessa
-- non deve comparire due volte (non succede — `venue_access_not_self_ck` lo
-- vieta — ma un `in (…)` con duplicati è uno spreco gratuito).
--
-- ⚠️ Nessun filtro su `closed_at`: le policy di prima non ce l'avevano, e una
-- sede chiusa resta consultabile (lo storico delle ore vive lì). È l'app a
-- tenerla fuori dalle liste operative.
create or replace function public.my_venue_ids(p_perm text default 'shifts')
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.id from public.venues v
   where v.owner_id = (select auth.uid())
  union
  select a.venue_id from public.venue_access a
   where a.user_id = (select auth.uid())
     and a.status  = 'active'
     and case p_perm
           when 'any'       then true
           when 'shifts'    then a.can_manage_shifts
           when 'staff'     then a.can_manage_staff
           when 'hours'     then a.can_view_hours
           when 'documents' then a.can_manage_documents
           when 'venue'     then a.can_manage_venue
           -- ⚠️ Un permesso sconosciuto nega, non concede: un refuso in una
           -- policy futura deve costare una schermata vuota, mai un accesso.
           else false
         end;
$$;

-- Ora è letteralmente la stessa regola: una definizione sola, due forme.
create or replace function public.can_manage_venue(
  p_venue uuid,
  p_perm  text default 'shifts'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_venue in (select public.my_venue_ids(p_perm));
$$;

comment on table public.venue_access is
  'Accesso delegato a una sede, con permessi per area. Il titolare non ha righe '
  'qui: venues.owner_id resta la fonte di verità del "può tutto".';

-- ---------------------------------------------------------------------------
-- 5. Il proprietario di una sede non si cambia da REST
-- ---------------------------------------------------------------------------
-- `"venues: owner crud"` concede UPDATE con `with check (owner_id = auth.uid())`:
-- oggi va bene perché solo il proprietario passa la `using`. Ma appena un
-- delegato con permesso 'venue' potrà modificare i dati della sede (F1.4), un
-- `update venues set owner_id = <me>` supererebbe entrambe le clausole. Meglio
-- chiudere la porta adesso, mentre è ancora teorica.
create or replace function public.venues_owner_is_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- `auth.uid()` è null per service_role e nell'editor SQL: una cessione di
  -- locale, se un giorno servirà, resta possibile da lì. Qui si chiude solo la
  -- strada REST, che è quella che un utente può percorrere da solo.
  if new.owner_id is distinct from old.owner_id
     and (select auth.uid()) is not null then
    raise exception 'owner_immutable';
  end if;
  return new;
end;
$$;

revoke execute on function public.venues_owner_is_immutable() from anon, authenticated, public;

drop trigger if exists venues_owner_is_immutable on public.venues;
create trigger venues_owner_is_immutable
  before update of owner_id on public.venues
  for each row execute function public.venues_owner_is_immutable();

-- ---------------------------------------------------------------------------
-- 6. E il contrario: un delegato non apre una sede propria
-- ---------------------------------------------------------------------------
-- È l'altra metà di `venue_access_one_company`. Senza, il vincolo si aggira
-- dall'altro verso: prima accetti la delega, poi crei un locale tuo, e ti ritrovi
-- due aziende nella stessa lista — con le ore di due datori di lavoro nello
-- stesso export. L'app nasconde già "Nuova sede" ai delegati (F1.4); questo è il
-- motivo per cui nasconderla basta.
create or replace function public.venues_owner_not_delegate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.venue_access a
     where a.user_id = new.owner_id and a.status <> 'revoked'
  ) then
    raise exception 'is_delegate';
  end if;
  return new;
end;
$$;

revoke execute on function public.venues_owner_not_delegate() from anon, authenticated, public;

drop trigger if exists venues_owner_not_delegate on public.venues;
create trigger venues_owner_not_delegate
  before insert on public.venues
  for each row execute function public.venues_owner_not_delegate();
