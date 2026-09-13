-- Un titolare, più locali, le stesse persone.
--
-- Giuseppe ha un locale a Roma, uno a Milano e uno a Como, e Marco lavora in due
-- di essi. Fino a oggi quelle erano **due schede separate**: due anagrafiche, due
-- HACCP da caricare, due storici che nessuna schermata sapeva essere la stessa
-- persona. L'unique parziale `staff_members_venue_waiter_uq (venue_id, waiter_id)`
-- lo diceva esplicitamente: l'identità di un dipendente era per *locale*.
--
-- Da qui in avanti:
--
--   · `staff_people`  = la PERSONA, scopata sul titolare. Anagrafica, telefono,
--                       account collegato, e (20260913100100) i documenti.
--   · `staff_members` = l'APPARTENENZA persona × sede. Tipo di impiego, stato
--                       dell'invito, ruoli, turni, ore.
--
-- Le ore restano per sede perché sono due buste paga diverse; i documenti salgono
-- sulla persona perché un HACCP è della persona, non del locale.
--
-- ── Perché `display_name`, `waiter_id`, `phone` e `note` RESTANO su
--    `staff_members` come colonne DERIVATE ───────────────────────────────────
--
-- Non è duplicazione: è un mirror che scrive un trigger BEFORE, nello stesso
-- spirito di `freeze_assignment_role` (20260912120000), che rimette il valore
-- vecchio quando chi scrive non ha il diritto di deciderlo. Tre ragioni concrete:
--
--   1. ~30 punti di LETTURA non cambiano. `display_name`/`waiter_id` stanno
--      dentro embed PostgREST in percorsi caldi (`getVenueStaff`,
--      `getVenueShiftsRange`, `getTodayAssignments`, il planning web, la RPC
--      `get_venue_hours_summary`). Togliere le colonne sarebbe una PR monolitica.
--   2. Le RLS restano valide verbatim: `"staff_members: linked waiter read"`,
--      `"venue_roles: staff read"` e `"staff_member_roles: linked waiter read"`
--      passano tutte da `sm.waiter_id = auth.uid()` e usano
--      `staff_members_waiter_idx`.
--   3. Il realtime continua a funzionare senza toccare la publication.
--      `RealtimeSync` ascolta `staff_members` con filtro server `venue_id=eq.`.
--      Rinominare una persona propaga sul mirror → l'UPDATE genera l'evento.
--      Senza mirror servirebbe aggiungere `staff_people` a `supabase_realtime` e
--      un canale **senza** filtro server-side (la tabella non ha `venue_id`):
--      esattamente il pattern che il commento in testa a RealtimeSync.tsx vieta.
--
-- Una verità (`staff_people`), una cache (`staff_members`), imposta dal DB. Il
-- mirror si potrà togliere il giorno in cui ogni lettore leggerà la persona.
--
-- ── La sincronizzazione va in UNA direzione sola ─────────────────────────────
--
-- Persona → appartenenze, mai il contrario. Un trigger che propagasse anche
-- all'indietro (scrivo il nome sulla scheda Milano, lui lo porta sulla persona,
-- lei lo riporta sulle altre schede) toccherebbe la riga Milano mentre è ancora
-- dentro il proprio BEFORE: è il modo più breve per ottenere un "tuple
-- concurrently updated" in produzione. Di conseguenza **il client scrive
-- l'anagrafica su `staff_people`**, e il write path dello staff cambia in questa
-- stessa fase (`src/features/staff/api.ts` + le 4 schermate che lo usano).

-- ---------------------------------------------------------------------------
-- 1) La persona
-- ---------------------------------------------------------------------------
create table if not exists public.staff_people (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  full_name  text not null check (btrim(full_name) <> ''),
  phone      text,
  note       text,
  waiter_id  uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.staff_people is
  'Una persona dell''organico di un titolare, indipendente dalle sedi in cui lavora. È il livello a cui appartengono anagrafica, telefono, account collegato e documenti; la sede, il tipo di impiego, i ruoli e le ore stanno su staff_members.';

-- Un account collegato al massimo a UNA persona per titolare. È QUESTO vincolo —
-- non più (venue_id, waiter_id) — che impedisce a Giuseppe di avere due
-- anagrafiche dello stesso Marco perché lavora a Roma e a Milano.
create unique index if not exists staff_people_owner_waiter_uq
  on public.staff_people (owner_id, waiter_id)
  where waiter_id is not null;

create index if not exists staff_people_owner_idx
  on public.staff_people (owner_id);

-- Parte da qui l'`exists` delle due policy "manager reads own staff" riscritte
-- in fondo a questa migration.
create index if not exists staff_people_waiter_idx
  on public.staff_people (waiter_id)
  where waiter_id is not null;

drop trigger if exists staff_people_updated_at on public.staff_people;
create trigger staff_people_updated_at
  before update on public.staff_people
  for each row execute function public.update_updated_at();

-- ---------------------------------------------------------------------------
-- 2) staff_members diventa l'appartenenza persona × sede
-- ---------------------------------------------------------------------------
-- FK semplice e NON composita, di proposito: una seconda FK da staff_members
-- verso staff_people (o verso venues) renderebbe l'embed ambiguo per PostgREST
-- ("more than one relationship found") e romperebbe `venue:venues(...)` in
-- getMyPendingInvites/getMyEmployers. La coerenza titolare-persona-sede la
-- garantisce il trigger del punto 4, che è una garanzia più forte di una FK:
-- vale anche per le RPC DEFINER e per service_role.
alter table public.staff_members
  add column if not exists person_id uuid references public.staff_people(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 3) Backfill — è qui che avviene la fusione
-- ---------------------------------------------------------------------------

-- 3a) Schede COLLEGATE a un account: una persona per (titolare, account).
--     Le tre schede di Marco diventano una persona con tre appartenenze.
insert into public.staff_people (owner_id, full_name, phone, note, waiter_id, created_at)
select
  v.owner_id,
  -- Il nome della scheda più vecchia: è quello scritto per primo, e la scheda
  -- più vecchia è quella con più storico attaccato.
  (array_agg(sm.display_name order by sm.created_at, sm.id))[1],
  -- Primo telefono non nullo (i null in fondo), stesso ordine.
  (array_agg(sm.phone order by (sm.phone is null), sm.created_at, sm.id))[1],
  -- Le note sono osservazioni scritte per sede: tenerne una sola perderebbe
  -- informazione senza avvisare. Si concatenano le distinte non vuote.
  nullif(string_agg(distinct nullif(btrim(sm.note), ''), E'\n'), ''),
  sm.waiter_id,
  min(sm.created_at)
from public.staff_members sm
join public.venues v on v.id = sm.venue_id
where sm.waiter_id is not null
group by v.owner_id, sm.waiter_id;

update public.staff_members sm
   set person_id = p.id
  from public.venues v
  join public.staff_people p on p.owner_id = v.owner_id
 where v.id = sm.venue_id
   and p.waiter_id = sm.waiter_id
   and sm.waiter_id is not null;

-- 3b) Schede SENZA account: una persona per scheda, NESSUNA fusione per nome.
--     "Marco" a Roma e "Marco" a Milano possono essere due persone diverse, e
--     sbagliare qui significa fondere due storici di ore — un danno che nessuno
--     si accorge di aver subito. Chi vuole unirle lo farà a mano dalla UI.
--
--     L'id della persona = l'id della scheda: è già unico, e ci risparmia una
--     tabella di mappatura o un giro in plpgsql.
insert into public.staff_people (id, owner_id, full_name, phone, note, created_at)
select sm.id, v.owner_id, sm.display_name, sm.phone, nullif(btrim(sm.note), ''), sm.created_at
  from public.staff_members sm
  join public.venues v on v.id = sm.venue_id
 where sm.waiter_id is null;

update public.staff_members sm
   set person_id = sm.id
 where sm.waiter_id is null;

alter table public.staff_members alter column person_id set not null;

-- ---------------------------------------------------------------------------
-- 4) Il guardiano e il mirror: un trigger solo
-- ---------------------------------------------------------------------------
-- Fa due cose che sono la stessa frase: un'appartenenza lega una persona a una
-- sede **dello stesso titolare**, e le colonne derivate le decide la persona,
-- non chi scrive.
--
-- DEFINER perché la verifica deve essere assoluta e non relativa al chiamante:
-- vale anche quando scrive una RPC DEFINER (`respond_to_staff_invite`) o
-- service_role. Stessa forma, e stesso warning intenzionale dell'advisor, di
-- `can_access_staff_documents` (20260912130100).
create or replace function public.sync_staff_member_from_person()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner  uuid;
  v_name   text;
  v_phone  text;
  v_note   text;
  v_waiter uuid;
begin
  select p.owner_id, p.full_name, p.phone, p.note, p.waiter_id
    into v_owner, v_name, v_phone, v_note, v_waiter
    from public.staff_people p
   where p.id = new.person_id;

  if v_owner is null then
    raise exception 'staff_members.person_id inesistente: %', new.person_id;
  end if;

  if not exists (
    select 1 from public.venues v
     where v.id = new.venue_id and v.owner_id = v_owner
  ) then
    raise exception
      'la persona % non appartiene al titolare del locale %', new.person_id, new.venue_id;
  end if;

  -- Colonne derivate. Una scrittura del client su queste viene rimessa a posto
  -- senza errore: non è un errore dell'utente, è una scrittura che non gli
  -- compete. L'anagrafica si modifica su `staff_people`, ed è quello che fa il
  -- client da questa fase in avanti.
  new.display_name := v_name;
  new.waiter_id    := v_waiter;
  new.phone        := v_phone;
  new.note         := v_note;
  return new;
end;
$$;

revoke execute on function public.sync_staff_member_from_person()
  from anon, authenticated, public;

-- `update of` e non `update` secco: cambiare solo employment_type o link_status
-- non ha niente da risincronizzare, e sono gli update più frequenti
-- (respond_to_staff_invite a ogni invito accettato).
drop trigger if exists staff_members_sync_person on public.staff_members;
create trigger staff_members_sync_person
  before insert or update of person_id, venue_id, display_name, waiter_id, phone, note
  on public.staff_members
  for each row execute function public.sync_staff_member_from_person();

-- Direzione opposta — l'unica: rinominare la persona, cambiarle il telefono o
-- slegarne l'account aggiorna tutte le sue appartenenze. L'UPDATE qui dentro
-- rifa scattare il BEFORE di sopra, che rilegge la persona e riscrive gli stessi
-- valori: converge. Il `where ... is distinct from ...` impedisce il giro a
-- vuoto e, soprattutto, evita di riscrivere righe già corrette — che sul
-- realtime significherebbe un evento per appartenenza a ogni salvataggio.
create or replace function public.sync_staff_members_on_person_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.staff_members sm
     set display_name = new.full_name,
         waiter_id    = new.waiter_id,
         phone        = new.phone,
         note         = new.note
   where sm.person_id = new.id
     and (sm.display_name is distinct from new.full_name
          or sm.waiter_id is distinct from new.waiter_id
          or sm.phone     is distinct from new.phone
          or sm.note      is distinct from new.note);
  return null;
end;
$$;

revoke execute on function public.sync_staff_members_on_person_change()
  from anon, authenticated, public;

drop trigger if exists staff_people_sync_members on public.staff_people;
create trigger staff_people_sync_members
  after update of full_name, waiter_id, phone, note on public.staff_people
  for each row execute function public.sync_staff_members_on_person_change();

-- Una persona senza appartenenze non esiste. Oggi togliere qualcuno dallo staff
-- cancella la scheda e con lei i documenti: questa è la regola che conserva quel
-- comportamento ora che i documenti stanno un livello sopra.
--
-- Sta in un trigger e non nel client perché i punti che cancellano
-- un'appartenenza sono quattro: `removeStaffMember`, `leave_venue`,
-- `respond_to_staff_invite` (rifiuto) e la cascata della cancellazione del
-- locale. Tre di questi non passano dal client.
create or replace function public.delete_orphan_staff_person()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.staff_people p
   where p.id = old.person_id
     and not exists (
       select 1 from public.staff_members sm where sm.person_id = p.id
     );
  return null;
end;
$$;

revoke execute on function public.delete_orphan_staff_person()
  from anon, authenticated, public;

-- Il nome lo fa scattare DOPO `staff_members_notify_removed` (i trigger sullo
-- stesso evento vanno in ordine alfabetico): quello legge solo OLD e sarebbe
-- indifferente, ma l'ordine esplicito evita di doverselo richiedere.
drop trigger if exists staff_members_zz_orphan_person on public.staff_members;
create trigger staff_members_zz_orphan_person
  after delete on public.staff_members
  for each row execute function public.delete_orphan_staff_person();

-- 4b) Il primo allineamento del mirror, a mano.
--
-- Il backfill del punto 3 è avvenuto prima che i trigger esistessero, e per le
-- schede fuse il nome della persona è quello della scheda **più vecchia**: la
-- scheda Milano di Marco ha ancora il proprio ("Marco R." invece di "Marco
-- Rossi"). Senza questo passaggio il mirror nascerebbe già divergente, e la
-- query di verifica in coda alla fase lo troverebbe.
update public.staff_members sm
   set display_name = p.full_name,
       waiter_id    = p.waiter_id,
       phone        = p.phone,
       note         = p.note
  from public.staff_people p
 where p.id = sm.person_id
   and (sm.display_name is distinct from p.full_name
        or sm.waiter_id is distinct from p.waiter_id
        or sm.phone     is distinct from p.phone
        or sm.note      is distinct from p.note);

-- ---------------------------------------------------------------------------
-- 5) Vincoli e indici dell'appartenenza
-- ---------------------------------------------------------------------------
create unique index if not exists staff_members_venue_person_uq
  on public.staff_members (venue_id, person_id);

-- person_id da sola non è il prefisso dell'unique di sopra: serve al trigger
-- degli orfani, a "in quali altre sedi lavora" e alla cascata della persona.
create index if not exists staff_members_person_idx
  on public.staff_members (person_id);

-- L'unique parziale (venue_id, waiter_id) di 20260712070246 va VIA. Non perché
-- dia fastidio, ma perché è ormai implicato:
--     unique (owner_id, waiter_id) su staff_people
--   + unique (venue_id, person_id) su staff_members
--   + persona e sede dello stesso titolare (trigger del punto 4)
--   ⟹ due appartenenze della stessa sede non possono condividere waiter_id.
-- Tenerlo sarebbe un secondo indice unico mantenuto su una colonna DERIVATA.
-- `staff_members_waiter_idx` (non unico) RESTA: lo usano le RLS.
drop index if exists public.staff_members_venue_waiter_uq;

-- Da qui in poi display_name lo scrive il trigger. Senza default i tipi generati
-- continuerebbero a pretenderlo in ogni insert, e ogni chiamante dovrebbe
-- passare un valore che viene comunque buttato.
alter table public.staff_members alter column display_name set default '';

-- ---------------------------------------------------------------------------
-- 6) RLS
-- ---------------------------------------------------------------------------
alter table public.staff_people enable row level security;

drop policy if exists "staff_people: owner all" on public.staff_people;
create policy "staff_people: owner all"
  on public.staff_people for all
  to authenticated
  using      (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Il professionista legge la propria riga: gli serve per la schermata documenti,
-- che da 20260913100100 è una cartella per datore di lavoro e non più per sede.
drop policy if exists "staff_people: linked waiter read" on public.staff_people;
create policy "staff_people: linked waiter read"
  on public.staff_people for select
  to authenticated
  using (waiter_id = (select auth.uid()));

-- Il `with check` dell'appartenenza guadagna la seconda metà del controllo: la
-- sede è mia **e** la persona è mia. Stesso criterio di
-- `"staff_member_roles: owner all"` (20260912120000), che verifica due cose in un
-- exists solo. Il trigger resta la garanzia assoluta; la policy serve a dare al
-- client l'errore giusto subito, invece di un'eccezione da plpgsql.
drop policy if exists "staff_members: owner all" on public.staff_members;
create policy "staff_members: owner all"
  on public.staff_members for all
  to authenticated
  using (
    exists (
      select 1 from public.venues v
       where v.id = staff_members.venue_id and v.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.venues v
        join public.staff_people p on p.owner_id = v.owner_id
       where v.id = staff_members.venue_id
         and p.id = staff_members.person_id
         and v.owner_id = (select auth.uid())
    )
  );

-- Le due policy di 20260912130000 smettono di passare da staff_members → venues:
-- "è nel mio organico" ora si esprime in un salto invece di due, e parte da
-- `staff_people_waiter_idx`. Il criterio non cambia di una virgola — cambia solo
-- il livello a cui vive l'identità del dipendente.
drop policy if exists "profiles: manager reads own staff" on public.profiles;
create policy "profiles: manager reads own staff"
  on public.profiles for select
  to authenticated
  using (
    -- Il guard sul ruolo resta: da qui si leggono i profili dei professionisti
    -- in organico, non quelli di altri gestori.
    role = 'waiter'::public.user_role
    and exists (
      select 1 from public.staff_people p
       where p.waiter_id = profiles.id and p.owner_id = (select auth.uid())
    )
  );

drop policy if exists "waiter_profiles: manager reads own staff" on public.waiter_profiles;
create policy "waiter_profiles: manager reads own staff"
  on public.waiter_profiles for select
  to authenticated
  using (
    exists (
      select 1 from public.staff_people p
       where p.waiter_id = waiter_profiles.id and p.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 7) delete_account: le due righe sullo staff cambiano bersaglio
-- ---------------------------------------------------------------------------
-- Il resto del corpo è identico a 20260912130200: `create or replace` vuole la
-- funzione intera, quindi cambiare altro da qui è un errore.
--
-- ⚠️ La FK `staff_members.waiter_id → profiles on delete set null`
-- (20260712070246) resta, ed è ora un percorso che **divergerebbe** dal mirror:
-- azzererebbe la colonna derivata senza toccare la persona. Non scatta mai,
-- perché `delete_account` non cancella la riga `profiles` — la trasforma in una
-- lapide. Se un giorno qualcuno cancellasse davvero un profilo, questo è il
-- punto da sistemare.
create or replace function public.delete_account(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.profiles where id = p_user;
  if not found then
    return;
  end if;

  -- ⟨aggiunta 20260912130200⟩ Vale per entrambi i ruoli: anche un gestore può
  -- aver caricato documenti sulle schede del suo organico.
  delete from public.staff_documents where uploaded_by = p_user;

  if v_role = 'waiter' then
    -- Reputazione, candidature e scheda professionale sono dati personali suoi.
    delete from public.reviews            where waiter_id = p_user;
    delete from public.waiter_experiences where waiter_id = p_user;
    delete from public.waiter_profiles    where id        = p_user;
    delete from public.applications       where waiter_id = p_user;

    -- ⟨modificato 20260913100000⟩ Inviti mai accettati: via l'appartenenza. Il
    -- trigger degli orfani porta con sé la persona se quello era il suo unico
    -- locale. Si parte dalla persona e non da `staff_members.waiter_id` perché è
    -- la persona a possedere il legame con l'account: la colonna sulla scheda è
    -- solo il mirror.
    delete from public.staff_members sm
      where sm.link_status = 'pending'
        and sm.person_id in (
          select p.id from public.staff_people p where p.waiter_id = p_user
        );

    -- Collaborazioni attive: si slega l'ACCOUNT dalla persona, e il trigger
    -- propaga il null su tutte le appartenenze. Le schede restano al titolare,
    -- altrimenti perderebbe le ore già lavorate.
    update public.staff_people set waiter_id = null where waiter_id = p_user;
  else
    -- Il locale sopravvive per non distruggere lo storico altrui, ma va chiuso.
    update public.venues
      set closed_at = now()
      where owner_id = p_user and closed_at is null;

    -- I turni futuri ancora aperti non avrebbero più nessuno a gestirli.
    -- L'update fa scattare notify_on_shift_cancelled, che avvisa assegnati e
    -- candidati accettati: è il comportamento voluto, non un effetto collaterale.
    update public.shifts s
      set status = 'cancelled'
      where s.venue_id in (select v.id from public.venues v where v.owner_id = p_user)
        and s.date >= current_date
        and s.status <> 'cancelled';

    -- ⚠️ Le sue `staff_people` NON cadono per cascata: `profiles` resta in piedi
    -- come lapide, quindi la FK su owner_id non scatta mai. È coerente con i
    -- locali, che sopravvivono chiusi — l'organico resta attaccato ai locali
    -- chiusi esattamente come i turni.
  end if;

  -- Comuni a entrambi i ruoli.
  delete from public.push_tokens   where user_id = p_user;
  delete from public.notifications where user_id = p_user;

  -- La lapide: nessun dato personale, ma la riga resta perché conversazioni,
  -- turni e locali la referenziano.
  update public.profiles
    set full_name          = 'Utente eliminato',
        avatar_url         = null,
        phone              = null,
        bio                = null,
        city               = null,
        notification_prefs = '{}'::jsonb,
        deleted_at         = now()
    where id = p_user;
end;
$$;

revoke all on function public.delete_account(uuid) from anon, authenticated, public;

analyze public.staff_people;
analyze public.staff_members;
