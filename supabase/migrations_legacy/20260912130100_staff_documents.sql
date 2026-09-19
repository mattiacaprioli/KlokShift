-- Documenti dello staff: HACCP, contratto, visita medica, patentino — con le
-- scadenze.
--
-- Un pezzo di questa cosa esisteva già, e sbagliava in quattro modi. Il passo 2
-- dell'onboarding faceva caricare «certificazioni» scelte da un elenco chiuso di
-- due voci (AIS Sommelier, HACCP) dentro il bucket privato `certifications`,
-- appendendo il path a `waiter_profiles.certifications`:
--
--   1. quella colonna non era letta da **nessuna** riga di interfaccia in tutto
--      il repo — come `waiter_profiles.skills`, scritta dallo stesso passo;
--   2. le policy dello storage davano accesso al solo proprietario, quindi il
--      locale — l'unico a cui quei documenti servono — non poteva aprirli;
--   3. dopo l'onboarding non c'era alcun modo di rivedere, sostituire o
--      eliminare un file: si caricava e spariva per sempre;
--   4. un `text[]` non può portare la scadenza, che è l'unica ragione per cui
--      questa roba interessa a un gestionale — un HACCP scaduto è un problema di
--      conformità, non un distintivo. (E un array si aggiorna in
--      read-modify-write, che perde le scritture concorrenti.)
--
-- Tre scelte di modello, da ricordare:
--
-- **Il documento sta sulla SCHEDA (`staff_members`), non sulla persona.** È
-- l'unico modello in cui il gestore può caricare l'HACCP di chi **non ha
-- l'app** — metà dell'organico è fatto di schede senza account, e sono proprio
-- quelle per cui il locale ha bisogno del documento in mano. In cambio i
-- documenti **non sono portabili**: chi lavora in due locali li carica due
-- volte, e chi lascia un locale li perde (la cascata sulla scheda). È anche il
-- motivo per cui «accesso revocato quando se ne va» non ha bisogno di nessuna
-- regola: sparita la scheda, sparito tutto.
--
-- **Il nome del documento è testo libero.** Non un enum: ci sono locali che
-- chiedono cose che non sappiamo nominare (un patentino carrelli,
-- un'assicurazione, un nulla osta). Stessa direzione dei ruoli di locale, che in
-- 20260912120000 sono passati da una costante a una tabella.
--
-- **La scadenza è facoltativa.** Un contratto a tempo indeterminato non scade, e
-- obbligare a inventare una data produce solo dati falsi.

-- ---------------------------------------------------------------------------
-- 1) La tabella
-- ---------------------------------------------------------------------------
create table if not exists public.staff_documents (
  id              uuid primary key default gen_random_uuid(),
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,
  name            text not null check (btrim(name) <> ''),
  storage_path    text not null unique,
  mime_type       text,
  size_bytes      integer,
  -- `date` e non `timestamptz`: una scadenza è un giorno, e un timestamp
  -- costringerebbe a scegliere un'ora che nessuno ha mai inserito.
  expires_at      date,
  -- Chi l'ha caricato: la scheda ha due mani sopra (il locale e, se collegato,
  -- il professionista) e sapere da quale viene un documento evita discussioni.
  -- `set null`: il caricatore può cancellare il proprio account, il documento
  -- resta del locale.
  uploaded_by     uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- ⚠️ Il vincolo che tiene in piedi la sicurezza dello Storage. La policy su
  -- `storage.objects` ha in mano solo il `name` dell'oggetto: deve poter dedurre
  -- da lì **a quale scheda** appartiene il file. Senza questo check si potrebbe
  -- registrare una riga che punta al file di un'altra persona e — avendone il
  -- path — chiederne la signed URL. Gli uuid non contengono `%` né `_`, quindi
  -- il `like` non ha caratteri jolly involontari.
  constraint staff_documents_path_owner_ck
    check (storage_path like staff_member_id::text || '/%')
);

-- FK e ordinamento della lista in un indice solo: si legge sempre per scheda e
-- sempre con le scadenze più vicine in cima (`nulls last` = «senza scadenza» in
-- fondo, che è anche l'ordine in cui li si vuole guardare).
create index if not exists staff_documents_member_idx
  on public.staff_documents (staff_member_id, expires_at nulls last);

create index if not exists staff_documents_uploaded_by_idx
  on public.staff_documents (uploaded_by);

-- Stessa funzione già usata da profiles e applications.
drop trigger if exists staff_documents_updated_at on public.staff_documents;
create trigger staff_documents_updated_at
  before update on public.staff_documents
  for each row execute function public.update_updated_at();

-- ---------------------------------------------------------------------------
-- 2) Il bucket
-- ---------------------------------------------------------------------------
-- Privato, al contrario di `avatars` (20260911130000): un avatar è fatto per
-- essere visto da chiunque veda la persona, un documento d'identità no. Il
-- prezzo è una signed URL a ogni apertura, ed è il prezzo giusto.
--
-- Bucket **nuovo** e non `certifications`: quello è nato senza limite di
-- dimensione né di mime type, ha un'altra convenzione di path, e contiene già
-- file di test non registrati in nessuna riga — allargarne la lettura al gestore
-- vorrebbe dire mostrargli dei file senza nome né scadenza.
--
-- I limiti stanno **sul bucket** e non solo nel client, perché il client si
-- aggira. `image/heic` incluso: la foto di un attestato scattata con un iPhone è
-- heic, e rifiutarla vuol dire rifiutare il caso più comune — a proporre
-- «Scarica» invece dell'anteprima ci pensa l'interfaccia.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'staff-documents',
  'staff-documents',
  false,
  10485760,                                   -- 10 MB: uno scan a colori di 4 pagine ci sta
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp',
    'image/heic', 'image/heif'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 3) Chi può toccare i documenti di una scheda
-- ---------------------------------------------------------------------------
-- Una funzione sola per una regola sola: **chi può toccare la scheda**, cioè il
-- proprietario del locale o il professionista collegato. La stessa condizione
-- serve in due posti — la policy sulla tabella e quella su `storage.objects` — e
-- il giorno in cui divergessero l'interfaccia elencherebbe un documento il cui
-- file risponde 403, o il contrario. Scriverla due volte è il modo in cui
-- questo succede.
--
-- DEFINER per la stessa ragione di `is_my_assigned_shift`: una policy su
-- `storage.objects` che interroga `staff_members` e `venues` farebbe scattare la
-- RLS di quelle tabelle **dentro** la valutazione della policy, per ogni riga di
-- oggetto. Non allarga niente: l'unico parametro è la scheda, e la risposta
-- riguarda sempre il **chiamante**. Stessa forma, e stessa WARN advisor
-- intenzionale, delle altre DEFINER→RPC del progetto.
create or replace function public.can_access_staff_documents(p_staff_member uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
      from public.staff_members sm
      join public.venues v on v.id = sm.venue_id
     where sm.id = p_staff_member
       and (v.owner_id = (select auth.uid()) or sm.waiter_id = (select auth.uid()))
  );
$$;

revoke execute on function public.can_access_staff_documents(uuid) from anon, public;
grant  execute on function public.can_access_staff_documents(uuid) to authenticated;

comment on function public.can_access_staff_documents(uuid) is
  'Il chiamante può vedere i documenti di questa scheda staff? Unica definizione della regola: la usano sia la policy di staff_documents sia quella di storage.objects, e devono restare la stessa frase.';

-- ---------------------------------------------------------------------------
-- 4) RLS sulla tabella
-- ---------------------------------------------------------------------------
alter table public.staff_documents enable row level security;

-- Una policy sola, `for all`: sulla scheda il locale e il professionista
-- collegato hanno gli stessi diritti. Il gestore carica per chi non ha l'app; il
-- professionista tiene aggiornati i propri. Distinguere chi ha caricato cosa è
-- un'informazione (`uploaded_by`), non un permesso.
drop policy if exists "staff_documents: venue people all" on public.staff_documents;
create policy "staff_documents: venue people all"
  on public.staff_documents for all
  to authenticated
  using      (public.can_access_staff_documents(staff_member_id))
  with check (public.can_access_staff_documents(staff_member_id));

-- ---------------------------------------------------------------------------
-- 5) RLS sullo Storage
-- ---------------------------------------------------------------------------
-- La policy vede solo `name`, cioè `{staff_member_id}/{file}`: la scheda si
-- ricava dalla prima cartella, ed è esatto perché `staff_documents_path_owner_ck`
-- impedisce a una riga di puntare fuori dalla cartella della propria scheda.
--
-- Il cast è `::uuid` e non `::text` sull'altro lato di proposito: se il primo
-- segmento non fosse un uuid il cast solleva un errore e la policy nega, invece
-- di confrontare stringhe e lasciar passare un path costruito a mano.
--
-- ⚠️ Questa policy è più larga della riga: dà accesso a **ogni** file nella
-- cartella di quella scheda, compresi gli orfani di un insert fallito. È una
-- scelta: legarla a `staff_documents` innescherebbe la RLS di quella tabella
-- dentro la valutazione di ogni oggetto, e gli orfani sono comunque file che una
-- delle due parti ha caricato su quella scheda.
--
-- Niente policy di **update**: sostituire un documento carica un path nuovo e poi
-- cancella il vecchio (un `upsert` sullo stesso path, interrotto a metà, avrebbe
-- già distrutto l'originale). Una policy che nessuno usa è una superficie che
-- nessuno controlla.
drop policy if exists "staff documents: read" on storage.objects;
create policy "staff documents: read" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'staff-documents'
    and public.can_access_staff_documents(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "staff documents: insert" on storage.objects;
create policy "staff documents: insert" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'staff-documents'
    and public.can_access_staff_documents(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "staff documents: delete" on storage.objects;
create policy "staff documents: delete" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'staff-documents'
    and public.can_access_staff_documents(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------------------
-- 6) Le colonne write-only e il bucket vecchio
-- ---------------------------------------------------------------------------
-- `skills` e `certifications` le scriveva solo il passo 2 dell'onboarding, e non
-- le leggeva nessuna riga di interfaccia. Non c'è niente da migrare, perché non
-- c'era niente da mostrare; restare avrebbe un costo (i tipi generati, ogni
-- `select *`, ogni futura review dello schema) e nessun beneficio.
--
-- Meno distruttiva di 20260912120000 per i client vecchi: l'unica lettura
-- esplicita era dentro `uploadCertification`, che sparisce nello stesso commit.
-- I `select *` su `waiter_profiles` continuano a funzionare con due colonne in
-- meno.
alter table public.waiter_profiles drop column if exists skills;
alter table public.waiter_profiles drop column if exists certifications;

-- Le policy del bucket vecchio non devono restare a proteggere niente.
drop policy if exists "certs: owner read"   on storage.objects;
drop policy if exists "certs: owner insert" on storage.objects;
drop policy if exists "certs: owner update" on storage.objects;
drop policy if exists "certs: owner delete" on storage.objects;

-- ⚠️ Il bucket `certifications` **non** viene eliminato qui. `delete from
-- storage.buckets` fallisce se dentro c'è ancora qualcosa, e cancellare le righe
-- di `storage.objects` toglierebbe i metadati lasciando i blob nel backend:
-- irraggiungibili e comunque fatturati. Sono dati di test: va svuotato a mano
-- (Studio → Storage → certifications → Select all → Delete, oppure
-- `supabase storage rm ss:///certifications --recursive`) e poi eliminato.
-- Farlo qui vorrebbe dire una migration che fallisce sul remoto e blocca la CI.

analyze public.staff_documents;
