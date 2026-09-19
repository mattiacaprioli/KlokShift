-- I documenti salgono dalla scheda alla persona.
--
-- `staff_documents` (20260912130100) pendeva da `staff_member_id`, e il commento
-- di quella migration lo diceva come limite noto: chi lavora in due locali carica
-- l'HACCP due volte, e dimettersi da uno dei due lo cancella. Con `staff_people`
-- (20260913100000) quel limite non ha più ragione di esistere: un HACCP è della
-- persona, e la persona è scopata sul titolare — che dei suoi registri è titolare
-- autonomo, esattamente come prima.
--
-- Cosa cambia per chi usa l'app:
--   · Marco carica l'HACCP una volta e vale per Roma e per Milano;
--   · il titolare lo vede aprendo Marco da qualsiasi sua sede;
--   · Marco si dimette da Roma e i documenti **restano**, perché lavora ancora a
--     Milano. Se lascia anche Milano, la persona sparisce (trigger degli orfani)
--     e i documenti con lei.
--
-- ── ⚠️ Perché questa migration CANCELLA i documenti esistenti ────────────────
--
-- Il path nello Storage deve cominciare con l'id di chi possiede il documento:
-- è da lì che la policy su `storage.objects` ricava chi può leggere il file
-- (`(storage.foldername(name))[1]`), e il check `staff_documents_path_owner_ck` lo
-- impone anche a livello di riga. Passare alla persona vuol dire cambiare quel
-- prefisso, e i file **non si possono spostare da SQL**: non esiste (per scelta,
-- 20260912130100 §5) una policy di UPDATE su `storage.objects`.
--
-- Le due alternative erano peggiori:
--
--   (a) far accettare alla funzione di sicurezza entrambi i prefissi, cercando
--       l'uuid prima in `staff_people` e poi in `staff_members`. Siccome i file
--       vecchi non si possono migrare, quell'`or` resterebbe **per sempre**
--       nell'unico punto che protegge i documenti. Una transizione senza fine è
--       un ramo permanente in una funzione DEFINER.
--   (b) allentare `staff_documents_path_owner_ck`. È letteralmente il vincolo che
--       tiene in piedi la sicurezza dello Storage: indebolirlo per migrare dei
--       dati di test è il peggior rapporto costo/beneficio possibile.
--
-- Al momento in cui è stata scritta, la tabella conteneva **1 riga** di test.
-- Prima di applicarla su un database con dati veri, contare cosa si perde:
--
--     select count(*), min(created_at) from public.staff_documents;
--
-- ⚠️ Qui spariscono le RIGHE, non i blob: Postgres non cancella dallo Storage.
-- Svuotare il bucket **prima**, altrimenti i file restano fatturati e invisibili:
--
--     supabase storage rm ss:///staff-documents --recursive
--
-- Effetto collaterale benefico: qualunque blob resti sotto un prefisso
-- `staff_member_id` diventa irraggiungibile da tutti, perché la funzione nuova
-- cerca quell'uuid in `staff_people` e non lo trova. Sono byte morti, non file
-- esposti.

delete from public.staff_documents;

-- ---------------------------------------------------------------------------
-- 1) La colonna cambia bersaglio (il CHECK cade insieme alla colonna)
-- ---------------------------------------------------------------------------
-- La policy della tabella nomina `staff_member_id`, quindi il `drop column`
-- fallisce finché esiste: va giù prima lei e si ricrea al punto 3. Le tre policy
-- su `storage.objects` invece dipendono dalla *funzione*, non dalla colonna, e
-- restano in piedi fino al punto 3 — il bucket non è mai senza protezione.
drop policy if exists "staff_documents: venue people all" on public.staff_documents;

alter table public.staff_documents drop column if exists staff_member_id;

alter table public.staff_documents
  add column if not exists person_id uuid not null
    references public.staff_people(id) on delete cascade;

alter table public.staff_documents
  drop constraint if exists staff_documents_path_owner_ck;
alter table public.staff_documents
  add constraint staff_documents_path_owner_ck
  check (storage_path like person_id::text || '/%');

drop index if exists public.staff_documents_member_idx;
-- `expires_at nulls last`: la lista si ordina per scadenza più vicina, e chi non
-- scade va in fondo.
create index if not exists staff_documents_person_idx
  on public.staff_documents (person_id, expires_at nulls last);

-- ---------------------------------------------------------------------------
-- 2) La funzione di accesso: nome NUOVO, non `create or replace`
-- ---------------------------------------------------------------------------
-- `create or replace function` non può cambiare il nome di un parametro
-- ("cannot change name of input parameter"), e `drop function` fallisce finché le
-- quattro policy dipendono dalla vecchia. Quindi: funzione nuova → si ripuntano
-- le policy → si droppa la vecchia. Il nome nuovo è anche quello giusto.
--
-- Il titolare ora la raggiunge in UN salto (`staff_people.owner_id`) invece di
-- due: il join a `venues` non serve più, ed è la ragione per cui questa è anche
-- più economica della precedente.
create or replace function public.can_access_staff_person_documents(p_person uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
      from public.staff_people p
     where p.id = p_person
       and (p.owner_id = (select auth.uid()) or p.waiter_id = (select auth.uid()))
  );
$$;

revoke execute on function public.can_access_staff_person_documents(uuid) from anon, public;
grant  execute on function public.can_access_staff_person_documents(uuid) to authenticated;

comment on function public.can_access_staff_person_documents(uuid) is
  'Il chiamante può vedere i documenti di questa persona? Unica definizione della regola: la usano sia la policy di staff_documents sia quelle di storage.objects, e devono restare la stessa frase — se divergessero, una riga leggibile potrebbe puntare a un file che non si apre, o viceversa.';

-- ---------------------------------------------------------------------------
-- 3) Le quattro policy, identiche tranne la funzione
-- ---------------------------------------------------------------------------
create policy "staff_documents: venue people all"
  on public.staff_documents for all
  to authenticated
  using      (public.can_access_staff_person_documents(person_id))
  with check (public.can_access_staff_person_documents(person_id));

drop policy if exists "staff documents: read" on storage.objects;
create policy "staff documents: read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'staff-documents'
    and public.can_access_staff_person_documents(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "staff documents: insert" on storage.objects;
create policy "staff documents: insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'staff-documents'
    and public.can_access_staff_person_documents(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "staff documents: delete" on storage.objects;
create policy "staff documents: delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'staff-documents'
    and public.can_access_staff_person_documents(((storage.foldername(name))[1])::uuid)
  );

-- Nessuna policy di UPDATE, come prima e per la stessa ragione: sostituire un
-- documento carica un path nuovo e poi cancella il vecchio, così un upload
-- interrotto a metà non distrugge l'originale.

drop function if exists public.can_access_staff_documents(uuid);

-- `delete_account` NON cambia: `delete from public.staff_documents where
-- uploaded_by = p_user` non nomina la scheda.

analyze public.staff_documents;
