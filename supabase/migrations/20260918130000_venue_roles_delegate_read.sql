-- Il listino dei ruoli in LETTURA a tutti i collaboratori della sede.
--
-- Fino a qui `venue_roles` si leggeva solo con il permesso 'venue'
-- (20260916110000, sezione 6) o stando nell'organico di quella sede
-- ("venue_roles: staff read", 20260912120000). Un collaboratore con il solo
-- 'staff' non è né l'una né l'altra cosa: la sua lista tornava vuota, senza
-- errore, e la dashboard la mostrava come «Nessun ruolo definito». Stessa
-- scena per chi ha solo 'shifts' quando compone il fabbisogno di un turno.
--
-- Il permesso che era già stato dato diventava così mezzo inutilizzabile: le
-- policy di scrittura di `staff_member_roles` e `shift_role_requirements`
-- (20260916110000, sezioni 5 e 7) *accettano* quelle righe con 'staff' e
-- 'shifts' — passano da `venue_roles` in join, dove RLS non guarda — ma chi
-- assegna un ruolo deve prima poterne vedere il nome.
--
-- 'any' e non un permesso preciso: dentro `my_venue_ids` 'any' vuol dire "una
-- delega attiva su questa sede, qualunque casella", ed è la misura giusta.
-- L'elenco dei ruoli di una sede è un vocabolario — «Cameriere», «Barman» —,
-- non un dato sulle persone: non dice chi ci lavora, quanto guadagna o quando.
-- Restringerlo a 'staff' + 'shifts' costerebbe una terza policy il giorno che
-- nasce un altro permesso che ne ha bisogno.
--
-- La scrittura NON si muove: creare, rinominare e archiviare un ruolo resta di
-- chi ha 'venue', via "venue_roles: owner all", che questa migration non tocca.
-- Le policy permissive si sommano (OR), quindi la nuova allarga la sola SELECT.
--
-- Costo: `my_venue_ids` è già nel piano di ogni altra policy di questa tabella,
-- ed è `stable` — Postgres la valuta una volta per query, non per riga.

drop policy if exists "venue_roles: delegate read" on public.venue_roles;
create policy "venue_roles: delegate read"
  on public.venue_roles for select
  to authenticated
  using (venue_roles.venue_id in (select public.my_venue_ids('any')));
