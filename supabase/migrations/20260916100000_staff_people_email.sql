-- Email della persona in organico: serve a invitarla quando NON ha ancora un
-- account (il ramo `find_waiter_by_email` copre solo chi è già registrato), e a
-- riagganciarla alla sua scheda quando si registrerà.
--
-- Perché una colonna e non una tabella `staff_invites`: l'aggancio avviene per
-- match di email a registrazione confermata, non per click su un link. Il link
-- nell'email non autorizza nulla, quindi token/scadenza non avrebbero niente da
-- proteggere. Sulla riga, invece, l'email eredita la RLS già scritta per
-- `phone` (stessa natura: dato personale di un terzo) e la cancellazione di
-- `delete_orphan_staff_person` — niente PII orfana quando la persona sparisce.

alter table public.staff_people
  add column if not exists email text,
  -- Ultimo invio riuscito. null = email salvata ma invito mai partito.
  add column if not exists invited_at timestamptz,
  add column if not exists invite_count integer not null default 0,
  -- Valorizzata quando l'aggancio automatico trova già un'altra scheda dello
  -- stesso titolare collegata a quell'account: non si fonde nulla, decide lui.
  add column if not exists invite_conflict_at timestamptz;

alter table public.staff_people
  drop constraint if exists staff_people_email_format;
alter table public.staff_people
  add constraint staff_people_email_format
  check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

-- Una sola scheda per (titolare, email): è ciò che rende l'aggancio non
-- ambiguo — senza, due schede con la stessa email lascerebbero il linker a
-- indovinare a quale attaccare l'account. Stessa forma di
-- `staff_people_owner_waiter_uq`.
create unique index if not exists staff_people_owner_email_uq
  on public.staff_people (owner_id, lower(email))
  where email is not null;

-- L'indice su cui gira l'aggancio a ogni registrazione: solo le schede che
-- aspettano ancora un account.
create index if not exists staff_people_pending_email_idx
  on public.staff_people (lower(email))
  where email is not null and waiter_id is null;

comment on column public.staff_people.email is
  'Email con cui la persona è stata invitata. Dopo l''aggancio resta come dato di rubrica: l''indirizzo autoritativo è quello di auth.users.';
