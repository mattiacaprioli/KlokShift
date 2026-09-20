-- Ruoli personalizzati per locale: la lista la scrive il gestore.
--
-- Finora il ruolo era una stringa scelta da `STAFF_ROLES` (src/features/staff/
-- roles.ts): quindici voci hardcoded, uguali per tutti. La copertura confronta
-- stringhe esatte, quindi quella lista non si poteva nemmeno correggere —
-- 20260910104238 è servita proprio a ricucire i disallineamenti già creati.
--
-- Il limite non era tecnico ma di prodotto. Un locale che ha un "Pizzaiolo", un
-- "Capo partita" o un "PR" non poteva dirlo, e ormai l'app non parla solo a
-- ristoranti ma anche a hotel, catering, discoteche e agenzie di eventi. Da qui
-- una tabella di ruoli per locale, e due relazioni al posto delle due colonne
-- di testo:
--
--   staff_members.role           → staff_member_roles   (un dipendente, 1+ ruoli)
--   shift_role_requirements.role → role_id              (fabbisogno per ruolo)
--   shift_assignments.role_id (nuova)                   "in questo turno fa questo"
--
-- L'ultima è la novità vera. Prima il ruolo di un'assegnazione era **dedotto**
-- dall'anagrafica, quindi un dipendente con due mansioni non poteva stare su un
-- turno come Barman e sull'altro come Cameriere. Ora la copertura si calcola su
-- `shift_assignments.role_id`, cioè su una scelta esplicita di chi organizza.
--
-- ⚠️ Questa migration è **distruttiva per i client vecchi**: dopo il drop,
-- PostgREST risponde 400 a ogni select che nomina `role`. Si fa in una volta
-- sola perché l'app non è pubblicata e le uniche build in giro sono di test.

-- ---------------------------------------------------------------------------
-- 1) venue_roles
-- ---------------------------------------------------------------------------
create table if not exists public.venue_roles (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references public.venues(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  sort_order  integer not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);

-- Un ruolo per locale a meno di maiuscole e spazi: "cameriere", "Cameriere " e
-- "Cameriere" sono lo stesso ruolo, e due voci gemelle nel selettore sono un
-- bug che si scopre solo davanti a una copertura sbagliata.
--
-- Gli archiviati restano fuori dall'unicità di proposito: il nome torna
-- disponibile senza dover toccare lo storico, che continua a puntare alla riga
-- vecchia.
create unique index if not exists venue_roles_venue_name_uq
  on public.venue_roles (venue_id, lower(btrim(name)))
  where archived_at is null;

-- La FK e l'ordine del selettore in un indice solo. L'unique qui sopra è
-- parziale e non copre gli archiviati: questo sì.
create index if not exists venue_roles_venue_sort_idx
  on public.venue_roles (venue_id, sort_order);

-- ---------------------------------------------------------------------------
-- 2) staff_member_roles
-- ---------------------------------------------------------------------------
-- Nessun `id` sintetico: la coppia È la riga.
create table if not exists public.staff_member_roles (
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,
  role_id         uuid not null references public.venue_roles(id)   on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (staff_member_id, role_id)
);

-- `role_id` è la seconda colonna della PK, quindi scoperta: senza questo indice
-- ogni delete di un ruolo sarebbe una seq scan (stesso criterio di
-- 20260910120000, che ha indicizzato a mano tutte le FK).
create index if not exists staff_member_roles_role_idx
  on public.staff_member_roles (role_id);

-- ---------------------------------------------------------------------------
-- 3) Le due colonne role_id
-- ---------------------------------------------------------------------------
-- `on delete cascade` sul fabbisogno: senza ruolo non chiede nulla, tenerlo
-- sarebbe tenere una riga che non significa niente.
alter table public.shift_role_requirements
  add column if not exists role_id uuid references public.venue_roles(id) on delete cascade;

-- `on delete set null` sull'assegnazione: lì c'è dello storico (ore lavorate,
-- esito). Se il ruolo sparisse davvero, la persona avrebbe comunque lavorato
-- quel turno. In pratica non succede: il percorso previsto è `archived_at`.
alter table public.shift_assignments
  add column if not exists role_id uuid references public.venue_roles(id) on delete set null;

create index if not exists shift_role_requirements_role_idx
  on public.shift_role_requirements (role_id);

create index if not exists shift_assignments_role_idx
  on public.shift_assignments (role_id);

-- ---------------------------------------------------------------------------
-- 4) Backfill
-- ---------------------------------------------------------------------------
-- Due sorgenti, non una. I ruoli scritti sulle schede dell'organico sono la
-- fonte ovvia, ma NON bastano: `shift_role_requirements` può chiedere un
-- "Sommelier" a un locale che in organico non ne ha — è anzi il caso tipico, il
-- fabbisogno si scrive prima di aver trovato la persona. Backfillare solo dalla
-- prima sorgente lascerebbe quei fabbisogni senza `role_id`, cioè cancellati dal
-- `not null` più sotto: turni che smettono in silenzio di chiedere personale.
--
-- Tutto dentro un `do` che esce subito se la colonna non c'è più: plpgsql
-- analizza gli statement alla prima esecuzione, quindi l'uscita anticipata è
-- anche ciò che rende il file rieseguibile dopo il drop.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'staff_members'
      and column_name  = 'role'
  ) then
    return;
  end if;

  -- 4a) I ruoli dell'organico. `distinct on` sulla forma normalizzata fonde
  --     "Barman" e "barman " in una riga sola; `order by created_at` sceglie
  --     come nome quello scritto per primo, così il risultato non dipende
  --     dall'ordine fisico delle righe.
  insert into public.venue_roles (venue_id, name)
  select distinct on (sm.venue_id, lower(btrim(sm.role)))
         sm.venue_id,
         btrim(sm.role)
    from public.staff_members sm
   where btrim(coalesce(sm.role, '')) <> ''   -- copre sia null sia "   "
   order by sm.venue_id, lower(btrim(sm.role)), sm.created_at
  on conflict do nothing;

  -- 4b) I ruoli chiesti dai turni e assenti dall'organico. Il locale arriva da
  --     `shifts.venue_id` (not null, on delete cascade: un fabbisogno orfano
  --     non può esistere).
  insert into public.venue_roles (venue_id, name)
  select distinct on (s.venue_id, lower(btrim(r.role)))
         s.venue_id,
         btrim(r.role)
    from public.shift_role_requirements r
    join public.shifts s on s.id = r.shift_id
   where btrim(coalesce(r.role, '')) <> ''
     and not exists (
       select 1 from public.venue_roles vr
       where vr.venue_id = s.venue_id
         and lower(btrim(vr.name)) = lower(btrim(r.role))
     )
   order by s.venue_id, lower(btrim(r.role)), r.created_at
  on conflict do nothing;

  -- 4c) Ordine del selettore: prima i ruoli che più persone ricoprono, poi
  --     alfabetico. Senza, sarebbero tutti a 0 e l'ordine lo deciderebbe il caso.
  with ranked as (
    select vr.id,
           row_number() over (
             partition by vr.venue_id
             order by (
               select count(*)
                 from public.staff_members sm
                where sm.venue_id = vr.venue_id
                  and lower(btrim(sm.role)) = lower(btrim(vr.name))
             ) desc,
             lower(btrim(vr.name))
           ) as rn
      from public.venue_roles vr
  )
  update public.venue_roles vr
     set sort_order = ranked.rn
    from ranked
   where ranked.id = vr.id;

  -- 4d) Un ruolo a testa: prima ne esisteva al massimo uno. Chi aveva `role`
  --     null o vuoto resta SENZA ruoli, ed è la rappresentazione onesta del
  --     dato — l'interfaccia sapeva già mostrare "nessun ruolo".
  insert into public.staff_member_roles (staff_member_id, role_id)
  select sm.id, vr.id
    from public.staff_members sm
    join public.venue_roles vr
      on vr.venue_id = sm.venue_id
     and lower(btrim(vr.name)) = lower(btrim(sm.role))
   where btrim(coalesce(sm.role, '')) <> ''
  on conflict do nothing;

  -- 4e) Fabbisogni. Match sulla forma normalizzata: dopo 20260910104238 i valori
  --     sono canonici, ma un client vecchio può averne scritto uno con
  --     maiuscole diverse nel frattempo.
  update public.shift_role_requirements r
     set role_id = vr.id
    from public.shifts s
    join public.venue_roles vr on vr.venue_id = s.venue_id
   where s.id = r.shift_id
     and lower(btrim(vr.name)) = lower(btrim(r.role))
     and r.role_id is null;

  -- 4f) Assegnazioni: il ruolo che la persona aveva in anagrafica. Il
  --     `having count(*) = 1` oggi è sempre vero (un ruolo a testa, v. 4d); è
  --     scritto così perché una riesecuzione a modello nuovo — quando qualcuno
  --     ha già due ruoli — non ne peschi uno a caso. Un update con join che
  --     matcha due righe sceglie in modo non deterministico.
  with single_role as (
    select smr.staff_member_id,
           (array_agg(smr.role_id))[1] as role_id
      from public.staff_member_roles smr
     group by smr.staff_member_id
    having count(*) = 1
  )
  update public.shift_assignments a
     set role_id = sr.role_id
    from single_role sr
   where sr.staff_member_id = a.staff_member_id
     and a.role_id is null;
end $$;

-- ---------------------------------------------------------------------------
-- 5) Vincoli finali e rimozione delle colonne vecchie
-- ---------------------------------------------------------------------------
-- Restano senza `role_id` solo le righe che avevano `role = ''`: il `not null`
-- non impediva la stringa vuota. Un fabbisogno che non nomina un ruolo non
-- esprime alcun fabbisogno.
delete from public.shift_role_requirements where role_id is null;

alter table public.shift_role_requirements
  alter column role_id set not null;

-- L'unique era su (shift_id, role), col nome generato da Postgres.
alter table public.shift_role_requirements
  drop constraint if exists shift_role_requirements_shift_id_role_key;

create unique index if not exists shift_role_requirements_shift_role_uq
  on public.shift_role_requirements (shift_id, role_id);

-- Ridondante: è il prefisso esatto dell'unique appena creato. Stesso criterio
-- con cui 20260910120000 ha tolto messages_conversation_created_idx.
drop index if exists public.shift_role_requirements_shift_idx;

alter table public.shift_role_requirements drop column if exists role;
alter table public.staff_members            drop column if exists role;

-- ---------------------------------------------------------------------------
-- 6) RLS
-- ---------------------------------------------------------------------------
alter table public.venue_roles        enable row level security;
alter table public.staff_member_roles enable row level security;

drop policy if exists "venue_roles: owner all" on public.venue_roles;
create policy "venue_roles: owner all"
  on public.venue_roles for all
  to authenticated
  using (
    exists (
      select 1 from public.venues v
      where v.id = venue_roles.venue_id and v.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.venues v
      where v.id = venue_roles.venue_id and v.owner_id = (select auth.uid())
    )
  );

-- Il professionista in organico legge i ruoli di quel locale: `shift_assignments
-- .role_id` e i fabbisogni rimandano qui, e senza questa policy vedrebbe degli
-- uuid al posto della propria mansione. Nessun filtro su `link_status`:
-- "staff_members: linked waiter read" non lo fa, e chi ha un invito pendente
-- deve poter leggere il ruolo per cui lo chiamano. Sono nomi di mansioni.
drop policy if exists "venue_roles: staff read" on public.venue_roles;
create policy "venue_roles: staff read"
  on public.venue_roles for select
  to authenticated
  using (
    exists (
      select 1 from public.staff_members sm
      where sm.venue_id = venue_roles.venue_id
        and sm.waiter_id = (select auth.uid())
    )
  );

-- ⚠️ Il `with check` verifica DUE cose in un exists solo: che la scheda sia sua
-- e che il ruolo sia dello STESSO locale della scheda. Senza il secondo, un
-- gestore con due locali potrebbe attaccare un ruolo del locale A a un
-- dipendente del locale B — nessuna FK lo vieta, perché `venue_id` non compare
-- in questa tabella.
drop policy if exists "staff_member_roles: owner all" on public.staff_member_roles;
create policy "staff_member_roles: owner all"
  on public.staff_member_roles for all
  to authenticated
  using (
    exists (
      select 1
        from public.staff_members sm
        join public.venues v on v.id = sm.venue_id
       where sm.id = staff_member_roles.staff_member_id
         and v.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.staff_members sm
        join public.venues v      on v.id = sm.venue_id
        join public.venue_roles r on r.venue_id = sm.venue_id
       where sm.id = staff_member_roles.staff_member_id
         and r.id  = staff_member_roles.role_id
         and v.owner_id = (select auth.uid())
    )
  );

-- Il professionista legge i PROPRI ruoli. Non quelli dei colleghi: le loro
-- schede già non gli sono visibili ("staff_members: linked waiter read"), e una
-- policy più larga qui aprirebbe una finestra su chi altro lavora lì.
drop policy if exists "staff_member_roles: linked waiter read" on public.staff_member_roles;
create policy "staff_member_roles: linked waiter read"
  on public.staff_member_roles for select
  to authenticated
  using (
    exists (
      select 1 from public.staff_members sm
      where sm.id = staff_member_roles.staff_member_id
        and sm.waiter_id = (select auth.uid())
    )
  );

-- Stesso buco, stesso rimedio, sul fabbisogno: la policy esistente guarda solo
-- `shift_id`, quindi non impedisce di nominare il ruolo di un altro locale.
drop policy if exists "shift_role_requirements: owner all" on public.shift_role_requirements;
create policy "shift_role_requirements: owner all"
  on public.shift_role_requirements for all
  to authenticated
  using (
    exists (
      select 1 from public.shifts s
      join public.venues v on v.id = s.venue_id
      where s.id = shift_role_requirements.shift_id
        and v.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.shifts s
        join public.venues v      on v.id = s.venue_id
        join public.venue_roles r on r.venue_id = s.venue_id
       where s.id = shift_role_requirements.shift_id
         and r.id = shift_role_requirements.role_id
         and v.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 7) Il ruolo di default di un'assegnazione
-- ---------------------------------------------------------------------------
-- Se chi entra ha un ruolo solo non c'è niente da scegliere: metterlo qui evita
-- che ogni singolo punto di inserimento debba ricordarsene (e copre i client non
-- ancora aggiornati, che altrimenti creerebbero righe con `role_id` null e
-- copertura a zero ovunque). Se ne ha due, `role_id` resta null e lo decide chi
-- assegna: sceglierne uno a caso direbbe "coperto" un turno che non lo è.
create or replace function public.default_assignment_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role_id is null then
    select (array_agg(smr.role_id))[1] into new.role_id
      from public.staff_member_roles smr
     where smr.staff_member_id = new.staff_member_id
    having count(*) = 1;
  end if;
  return new;
end;
$$;

drop trigger if exists shift_assignments_default_role on public.shift_assignments;
create trigger shift_assignments_default_role
  before insert on public.shift_assignments
  for each row execute function public.default_assignment_role();

revoke execute on function public.default_assignment_role()
  from anon, authenticated, public;

-- Il ruolo lo decide chi organizza, non chi lavora.
--
-- "shift_assignments: linked waiter update" esiste per far confermare o
-- rifiutare il turno, ma è una policy senza restrizioni di colonna: dal client
-- il professionista potrebbe cambiarsi il `role_id` e falsare la copertura del
-- locale. Qui il valore vecchio viene semplicemente rimesso — silenziosamente,
-- perché non è un errore dell'utente: è una scrittura che non gli compete.
create or replace function public.freeze_assignment_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role_id is distinct from old.role_id and not exists (
    select 1
      from public.shifts s
      join public.venues v on v.id = s.venue_id
     where s.id = new.shift_id
       and v.owner_id = (select auth.uid())
  ) then
    new.role_id := old.role_id;
  end if;
  return new;
end;
$$;

drop trigger if exists shift_assignments_freeze_role on public.shift_assignments;
create trigger shift_assignments_freeze_role
  before update on public.shift_assignments
  for each row execute function public.freeze_assignment_role();

revoke execute on function public.freeze_assignment_role()
  from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 8) Pagina Ore: i ruoli sono più di uno
-- ---------------------------------------------------------------------------
-- La colonna `role` era `sm.role`, che non esiste più. Ora un dipendente può
-- avere più mansioni, quindi la riga ne porta l'elenco: "Cameriere, Barman".
--
-- `create or replace` non basta: cambia il NOME di una colonna del record
-- restituito e Postgres lo rifiuta. Il drop si porta via anche i grant, che
-- infatti vengono rifatti sotto.
drop function if exists public.get_venue_hours_summary(uuid, date, date);

create or replace function public.get_venue_hours_summary(
  p_venue uuid,
  p_from  date,
  p_to    date
)
returns table (
  staff_member_id uuid,
  display_name    text,
  roles           text,
  shifts_count    integer,
  hours           numeric
)
language sql
stable
set search_path = ''
as $$
  select
    sm.id,
    sm.display_name,
    -- Sottoquery, non un join: un join su staff_member_roles moltiplicherebbe
    -- le righe e `count(*)`/`sum()` conterebbero ogni turno una volta per
    -- ruolo. Numeri gonfiati, e solo per chi ha due mansioni.
    (
      select string_agg(vr.name, ', ' order by vr.sort_order, vr.name)
        from public.staff_member_roles smr
        join public.venue_roles vr on vr.id = smr.role_id
       where smr.staff_member_id = sm.id
         and vr.archived_at is null
    ),
    count(*)::int,
    sum(coalesce(
      a.worked_hours,
      public.shift_duration_hours(s.start_time, s.end_time)
    ))
  from public.shift_assignments a
  join public.staff_members sm on sm.id = a.staff_member_id
  join public.shifts s         on s.id  = a.shift_id
  where s.venue_id = p_venue
    and s.kind = 'internal'
    and s.date >= p_from
    and s.date <  p_to
    and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
    and a.status not in ('declined', 'no_show')
  group by sm.id, sm.display_name
  order by 5 desc;
$$;

revoke execute on function public.get_venue_hours_summary(uuid, date, date) from anon, public;
grant  execute on function public.get_venue_hours_summary(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 9) Riassegnazione: il turno si porta dietro il ruolo
-- ---------------------------------------------------------------------------
-- Delete + insert resta la scelta giusta (v. 20260911120000: le notifiche sono
-- AFTER INSERT / AFTER DELETE e un UPDATE non ne farebbe scattare nessuna).
-- Cambia solo che ora la riga nuova deve nascere con un `role_id`, altrimenti
-- trascinare un turno su un'altra persona lo lascerebbe scoperto sul fabbisogno
-- che stava coprendo — il contrario di quello che il gesto vuol dire.
create or replace function public.reassign_shift_assignment(
  p_assignment uuid,
  p_staff_member uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_shift    uuid;
  v_old      uuid;
  v_old_role uuid;
  v_role     uuid;
  v_new      uuid;
begin
  select shift_id, staff_member_id, role_id
    into v_shift, v_old, v_old_role
    from public.shift_assignments
   where id = p_assignment;

  -- ⚠️ `not found` guarda l'ULTIMA query eseguita: questo controllo deve restare
  -- attaccato alla select qui sopra. Le select sul ruolo, più in basso, lo
  -- sovrascriverebbero.
  if not found then
    raise exception 'Assegnazione non trovata';
  end if;

  -- Trascinata sulla stessa persona: niente da fare, e nessuna notifica.
  if v_old = p_staff_member then
    return p_assignment;
  end if;

  -- La policy guarda il turno, non lo staff member: senza questo controllo si
  -- potrebbe assegnare un turno a una persona dell'organico di un altro locale.
  if not exists (
    select 1
      from public.staff_members sm
      join public.shifts s on s.id = v_shift
     where sm.id = p_staff_member
       and sm.venue_id = s.venue_id
  ) then
    raise exception 'La persona non fa parte dello staff del locale';
  end if;

  -- unique (shift_id, staff_member_id): meglio dirlo con parole nostre che
  -- lasciar salire un 23505 fino all'interfaccia.
  if exists (
    select 1
      from public.shift_assignments
     where shift_id = v_shift
       and staff_member_id = p_staff_member
  ) then
    raise exception 'Questa persona è già su questo turno';
  end if;

  -- Il ruolo della riga nuova, in ordine di preferenza:
  --   1. quello della vecchia assegnazione, se chi entra lo sa fare. È il caso
  --      che conta: il turno chiedeva un Barman, entra un'altra persona che fa
  --      il Barman, la copertura non si muove.
  select smr.role_id into v_role
    from public.staff_member_roles smr
   where smr.staff_member_id = p_staff_member
     and smr.role_id = v_old_role;   -- v_old_role null ⇒ zero righe ⇒ v_role null

  --   2. altrimenti il suo unico ruolo: non c'è niente da scegliere.
  if v_role is null then
    select (array_agg(smr.role_id))[1] into v_role
      from public.staff_member_roles smr
     where smr.staff_member_id = p_staff_member
    having count(*) = 1;
  end if;

  --   3. altrimenti null: ha più ruoli e nessuno è quello di prima. Sceglierne
  --      uno a caso direbbe al gestore che il turno è coperto quando non lo è;
  --      il pannello del turno glielo farà scegliere.

  delete from public.shift_assignments where id = p_assignment;

  insert into public.shift_assignments (shift_id, staff_member_id, role_id)
  values (v_shift, p_staff_member, v_role)
  returning id into v_new;

  return v_new;
end;
$$;

revoke execute on function public.reassign_shift_assignment(uuid, uuid) from anon, public;
grant execute on function public.reassign_shift_assignment(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10) Realtime
-- ---------------------------------------------------------------------------
-- La lista ruoli e i ruoli di una persona cambiano mentre il planning è aperto
-- su un'altra sessione (telefono ↔ dashboard). Stesso trattamento di
-- staff_members.
do $$
declare t text;
begin
  foreach t in array array['venue_roles', 'staff_member_roles'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

analyze public.venue_roles;
analyze public.staff_member_roles;
