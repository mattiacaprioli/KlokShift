-- Ore da contratto sulla persona.
--
-- ── Perché sulla persona e non sull'appartenenza ─────────────────────────────
--
-- Il contratto lo firma l'azienda, non il singolo locale: Marco che lavora a
-- Roma e a Milano ha *un* monte ore, e infatti le ore programmate si sommano già
-- per `staff_people.id` (`computeWeekLoad`), non per scheda di sede. Mettere il
-- target su `staff_members` vorrebbe dire confrontare una somma cross-sede con
-- due target diversi, e non esiste una risposta giusta a quel confronto.
--
-- ── Non è un vincolo ─────────────────────────────────────────────────────────
--
-- Nessun trigger, nessuna policy e nessun blocco lato client leggono queste
-- colonne per impedire qualcosa: servono a colorare la colonna ore del planning
-- e basta. Sono il metro *del titolare*, non una soglia di legge — quelle (40h
-- ordinarie, 48h settimanali) sono uscite dal prodotto con questa stessa fase,
-- perché non sono responsabilità nostra e un numero uguale per tutti non dice
-- niente su un part-time.

alter table public.staff_people
  add column if not exists contract_hours  numeric(5,2),
  add column if not exists contract_period text;

alter table public.staff_people
  drop constraint if exists staff_people_contract_period_ck,
  drop constraint if exists staff_people_contract_hours_ck,
  drop constraint if exists staff_people_contract_pair_ck;

-- `text` + check invece di un enum: aggiungere un periodo (quindicinale, annuale)
-- resta una riga, e i tre valori non viaggiano da nessuna parte se non qui — le
-- etichette italiane stanno nel client, in `features/staff/contract.ts`.
alter table public.staff_people
  add constraint staff_people_contract_period_ck
    check (contract_period is null or contract_period in ('day', 'week', 'month')),
  add constraint staff_people_contract_hours_ck
    check (contract_hours is null or (contract_hours > 0 and contract_hours <= 400)),
  -- O si dice tutto, o non si dice niente: "40" senza periodo non è un target, e
  -- un periodo senza ore nemmeno. Svuotare il campo nel form azzera entrambe.
  add constraint staff_people_contract_pair_ck
    check ((contract_hours is null) = (contract_period is null));

comment on column public.staff_people.contract_hours is
  'Ore che la persona deve fare nel periodo indicato da contract_period. NULL = nessun contratto registrato: il planning mostra le ore programmate senza giudicarle. Non è un vincolo — niente blocca un turno che lo supera.';

comment on column public.staff_people.contract_period is
  'Periodo a cui si riferisce contract_hours: day | week | month. Il planning lo converte a settimana per confrontarlo con le ore programmate.';
