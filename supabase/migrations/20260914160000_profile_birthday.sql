-- Il compleanno del professionista, se sceglie di metterlo.
--
-- Il titolare che ha qualcuno in organico da un anno non sa quando fargli gli
-- auguri, e l'app è l'unico posto dove quel dato potrebbe stare senza che
-- nessuno debba tenere un foglio a parte.
--
-- ── Giorno e mese, NON una data di nascita ─────────────────────────────────
--
-- Due `smallint` e non una colonna `date`, ed è la scelta portante di questa
-- migration: l'anno **non esiste da nessuna parte**, quindi non c'è niente da
-- nascondere e niente che possa sfuggire.
--
-- Una `birth_date` avrebbe funzionato altrettanto bene *finché* l'interfaccia
-- avesse mostrato solo giorno e mese — ma sarebbe stata una promessa scritta nel
-- client. `"profiles: manager reads own staff"` (20260912130000) concede al
-- titolare la **riga intera**, e le policy di Postgres non sanno restringere le
-- colonne: una richiesta REST scritta a mano avrebbe riportato l'anno, cioè
-- l'età di tutto l'organico. Qui invece la restrizione è nel dato.
--
-- Il giorno in cui servirà la data di nascita vera (un contratto, un cedolino)
-- il posto giusto sarà `staff_people`, che è l'anagrafica che tiene il titolare
-- — non questa colonna, che è del professionista e serve agli auguri.
--
-- ── Chi scrive e chi legge ─────────────────────────────────────────────────
--
-- Nessuna policy nuova, e non è una dimenticanza:
--   · scrive il professionista su di sé  → "profiles: own read/write";
--   · legge il titolare che lo ha in organico → "profiles: manager reads own
--     staff" (20260912130000).
-- La vetrina pubblica non è toccata: `get_waiter_public_card()` e
-- `private.waiter_public_cards_src()` elencano le colonne una per una, quindi
-- una colonna nuova su `profiles` non ci entra da sola.

alter table public.profiles
  add column if not exists birth_day   smallint,
  add column if not exists birth_month smallint;

comment on column public.profiles.birth_day is
  'Giorno del compleanno (1-31), facoltativo. Va sempre insieme a birth_month. L''anno non si salva di proposito: serve per gli auguri, non per l''età.';
comment on column public.profiles.birth_month is
  'Mese del compleanno (1-12), facoltativo. Va sempre insieme a birth_day.';

-- I due campi stanno in piedi insieme o per niente: un mese senza giorno non è
-- una data parziale utile, è una riga da cui l'interfaccia non sa che scrivere.
-- Il 29 febbraio è ammesso — esiste, e chi è nato allora festeggia lo stesso.
alter table public.profiles
  drop constraint if exists profiles_birthday_valid;
alter table public.profiles
  add constraint profiles_birthday_valid check (
    (birth_day is null and birth_month is null)
    or (
      birth_month between 1 and 12
      and birth_day between 1 and
        case birth_month
          when 2 then 29
          when 4 then 30
          when 6 then 30
          when 9 then 30
          when 11 then 30
          else 31
        end
    )
  );
