# Verifica delle concessioni del fondatore — M06a

Blocco del 6 ottobre 2026, nuova migration
`20261006000200_founder_concessions.sql`. Implementazione locale; nessuna
migration già pubblicata riscritta, nessuna concessione reale assegnata da Codex.

M06a realizza gratuità a vita immediata, variazione della capacità gratuita,
classificazioni aziende/account, note e registro atomico. M06 rimane in corso:
spese/economia, proroghe finite e flussi assistiti seguono; pagamenti, rinnovi,
rimborsi e cifre riconciliate dipendono da M09. Nessun codice pubblico di riscatto.
La quota documenti è dichiarata e verificata contro i byte noti al salvataggio;
il blocco degli upload per quota non è ancora applicato.

**Prima prova visuale, 6 ottobre:** l'utente ha mostrato la nuova scheda
Bar Teatro, con lettura server di controllo e registro disponibili. Il menu
«Nuova classificazione» si apriva vuoto: le opzioni erano racchiuse in un
componente che il `Select` personalizzato non interpreta. Corretto localmente
nei form aziende e account usando figli `<option>` diretti. Il test di
regressione riproduce il difetto prima della correzione e passa dopo;
suite corrente: 40 file / 282 test client, typecheck web, lint e build passano.
In questa prima prova non era ancora dimostrata una scrittura commerciale.

**Concessione confermata dall'utente:** lo screenshot di Da Buffa del
6 ottobre, 21:12 Europe/Rome mostra azienda Operativa, Team, una sede,
gratuità a vita da 21:11, quota dichiarata 2048 MiB, un periodo e un intervento
nel registro. Classificazione ancora Non classificato. La conferma è stata
eseguita dall'utente; non prova ancora variazioni, capacità, retry o export.
Il commit `50be4fc` contiene il fix menu; le quattro scelte restano da
verificare manualmente.

**Riordino UI locale:** quattro schede (Riepilogo, Persone e sedi, Gestione,
Cronologia), conteggi distinti dai limiti, situazione attuale distinta dalla
modifica preparata. Il modulo parte dalla concessione presente. Navigazione
nell'URL e pannelli mantenuti per conservare il lavoro durante il cambio
scheda. Verificati 41 file / 291 test client, typecheck web, lint e build;
nessuna nuova migration o scrittura remota da Codex. Prova visuale del
riordino dopo il rilascio: §8.

## Ambiente scelto

Il fondatore dichiara che per i prossimi due mesi il progetto ospitato
`rmlobxjlqlpixkvrzmfg` contiene soltanto propri account e aziende di test.
Il dev remoto separato è rimandato, da predisporre prima di persone esterne;
non è un prerequisito di M06a. Il banco SQL locale resta distinto dal Supabase
ospitato: Docker verifica DB/RLS/concorrenza, non Auth/TOTP o UI reali.

Le aziende Bar Teatro e Da Buffa sono state create prima della monetizzazione.
Applicare questa migration lascia invariati `migration_pending`, piano e
periodi esistenti. Ogni concessione viene assegnata solo dopo la conferma
esplicita del fondatore su una singola azienda.

## 1. Verifiche automatiche locali

Con Docker attivo, dalla root del repository:

```sh
supabase/tests/run.sh reset
supabase/tests/run.sh test
supabase/tests/gen-types.sh
yarn test:unit
yarn typecheck
yarn web:typecheck
CI=1 yarn lint
yarn web:build
```

`reset` ricostruisce soltanto le fixture del container `klokshift-pg`,
porta 54422. Non applicare bootstrap/seed dei test al progetto ospitato.
Prima di ripetere tutta la concorrenza, ripartire da reset.

Atteso: 15 file SQL/RLS e 6 suite concorrenti passano; 41 file / 291 test
client passano; tipi, lint e build web passano. Restano il warning React Hook
Form preesistente in `ShiftPanel.tsx` e l'avviso sulla dimensione del bundle.

Verifica eseguita il 6 ottobre 2026: tutti questi controlli passano. Le tre
nuove gare concorrenti passano contro sessioni Postgres distinte; non si
tratta di una simulazione lato client. Per il successivo riordino UI sono
stati ripetuti test client, typecheck web, lint e build; DB e RPC invariati.
Le ulteriori prove Auth/TOTP e le altre prove visuali restano aperte.

Le nuove prove coprono guard/MFA, separazione etichetta/diritti, dato mancante,
capacità persone/sedi/documenti, dimensioni ignote, periodi futuri, audit,
retry, revisioni vecchie e conservazione del registro dopo eliminazione del
destinatario. Tre gare reali verificano retry simultaneo, due modifiche dalla
stessa revisione e riduzione sedi concorrente con una nuova sede.

## 2. Prerequisito della prova visuale

Pubblicare il blocco mediante il normale percorso di rilascio del repository:
nuova migration sul progetto ospitato e nuovo build dashboard. Verificare
che GitHub Actions completi i test e i job `deploy-database / db-push` e
`deploy-pages / deploy`. Questi passaggi non sono stati eseguiti da Codex.

In un ambiente ancora a M05, le nuove RPC M06a non sono disponibili.
Non basta avviare il nuovo frontend locale se è collegato a un DB ospitato
privo della nuova migration. Sul progetto attuale le nuove letture e la
concessione sono già state mostrate dall'utente. Il riordino UI richiede
soltanto il rilascio della dashboard, senza nuove migration.

## 3. Classificare senza concedere diritti

1. Aprire [area del fondatore](https://klokshift.com/app/#/amministrazione)
   con l'account abilitato e verificare il secondo fattore.
2. Aprire **Aziende → Bar Teatro** (o una sola azienda propria scelta).
3. Aprire **Gestione → Gestisci piano e classificazione**, scegliere **Classificazione**,
   aprire **Nuova classificazione**. Atteso: Cliente, Interno, Test e Non
   classificato sono visibili. Scegliere **Test**, motivo
   `Azienda personale di test preesistente`.
4. Premere **Rivedi intervento**. Atteso: riepilogo della sola etichetta,
   senza modifica di piano, prova o scadenze.
5. Premere **Conferma intervento**. Atteso: etichetta Test e una riga nel
   registro con motivo, attore, data e identificativo.
6. Stato e piano devono restare quelli precedenti: Bar Teatro senza
   concessione resta **Migrazione da verificare**; Da Buffa già concessa
   resta Operativa/Team. Nessuna prova creata. L'altra azienda mantiene la
   sua etichetta. Controllare la riga in **Cronologia → Registro amministrativo**.

## 4. Assegnare una gratuità a vita

1. In **Gestione** scegliere **Gratuità a vita / variazione capacità**.
2. Per un'azienda con una sede aperta e meno di 31 persone, scegliere
   **Base**, **1 sede da concedere (totale)**, **2048 MiB**, motivo
   `Concessione personale per verifica M06a`. Se l'uso noto supera questi
   valori, scegliere capacità compatibili: nessun dato viene eliminato.
3. Premere **Rivedi intervento**. Atteso: azienda destinataria dalla scheda,
   piano, sedi totali, quota dichiarata, decorrenza immediata alla conferma,
   assenza di scadenza commerciale/carta/rinnovi e motivo.
4. Premere **Conferma intervento**. Atteso:
   - azienda Operativa, origine Gratuito a vita, piano Base;
   - limite persone 30 e sedi 1, quota dichiarata 2048 MiB;
   - nessuna fine operatività/archivio inventata;
   - nuovo periodo senza scadenza e nuova riga nel registro, in **Cronologia**;
   - nessuna prova avviata e nessun prezzo/checkout;
   - l'altra azienda resta invariata, anche con lo stesso titolare.
5. Premere Aggiorna. Atteso: stessi diritti e stesso numero di interventi.

## 5. Capacità, variazione e storico

1. Aprire **Dashboard cliente**, scegliere l'azienda concessa e aggiornare.
   Atteso: stato gratuito a vita, storico/organico/turni esistenti consultabili.
2. Con capacità di una sede già occupata, **+ Aggiungi sede → Crea sede**
   deve rifiutare una seconda sede per capacità, conservando quella esistente.
3. Tornare alla scheda fondatore e confermare una variazione gratuita a
   **Base / 2 sedi / 2048 MiB**, con nuovo motivo.
   Atteso: capacità 2, una concessione permanente corrente; in **Cronologia**
   il periodo precedente rimane visibile con la revoca e il motivo originale.
4. Nella dashboard cliente, creare la seconda sede.
   Atteso: creazione consentita; nessun addebito o checkout implicito.
5. Dal fondatore tentare di ridurre di nuovo a una sede mentre entrambe
   sono aperte. Atteso: errore capacità, concessione corrente e audit invariati.
6. Aprire un mese passato in **Storico/Ore**, consultare presenze e provare
   l'export disponibile. Atteso: dati e permessi storici conservati.

La stessa regola protegge Team → Base oltre 30 persone. È verificata nel
banco automatico; non occorre creare 31 schede nel progetto ospitato.

## 6. Conferma vecchia, doppio invio e note

1. Aprire la stessa azienda in due schede del browser. Preparare una
   classificazione diversa in entrambe, senza confermare.
2. Confermare nella prima scheda, poi nella seconda.
   Atteso: la seconda riceve «I dati sono cambiati» e non sovrascrive la prima.
   Tornare ai campi, aggiornare e preparare una nuova conferma esplicita.
3. Se una conferma incontra un errore di rete, usare **Riprova conferma**
   senza ricaricare o abbandonare la pagina: conserva lo stesso identificativo.
   Atteso: un solo effetto e una sola riga nel registro.
   Il doppio clic disabilita il pulsante durante il salvataggio; la gara
   simultanea e il replay server sono verificati automaticamente.
4. Aggiungere una **Nota amministrativa**. Atteso: nuova riga nel registro;
   piano, periodi e scadenze non cambiano. In archivio una nota non prolunga
   consultazione/export.

## 7. Account e accesso

1. Aprire **Account → un proprio account di test**, classificare come Test
   con motivo e conferma. Atteso: etichetta e audit account aggiornati;
   nessuna nuova appartenenza, authority, concessione aziendale o accesso admin.
2. Uscire e accedere con un proprio account fuori allowlist allo stesso URL.
   Atteso: area riservata, nessun dato o comando amministrativo.
3. Ripetere le prove Auth/MFA/revoca/reconnect ancora aperte di
   [M05](TEST-FOUNDER-M05.md), sulle fixture esplicitamente scelte.
   Le nuove mutazioni rileggono il guard anche prima di restituire un retry.

## 8. Provare il riordino UI

Ambiente: dashboard ospitata sul progetto attuale di soli test propri,
dopo il rilascio dell'aggiornamento frontend. Da Buffa ha già la concessione
Team/una sede assegnata dall'utente; questa prova non richiede una nuova
assegnazione o una nuova migration.

1. Aprire **Aziende → Da Buffa**. Atteso: Riepilogo selezionato, stato
   Operativa e piano Team; quattro schede sotto il nome. Nessun modulo di
   intervento visibile nel Riepilogo. Conteggio persone e limite sono su
   righe diverse; sedi aperte 1, sedi consentite 1.
2. Aprire **Persone e sedi**. Atteso: membri e sedi con paginazione,
   nessun campo di modifica del piano. I link agli account funzionano.
3. Aprire **Gestione**. Atteso: riquadro Situazione attuale (Team, una sede,
   2048 MiB) e, sotto, Prepara una modifica. Il modulo riprende i valori
   concessi. I menu devono mostrare le scelte, senza popup vuoti.
4. Cambiare un campo e scrivere un motivo di prova; premere **Rivedi
   intervento** senza confermare. Aprire Cronologia e tornare in Gestione.
   Atteso: riepilogo preparato conservato, nessun nuovo intervento nel
   registro, piano attuale invariato. Usare **Torna ai campi** per annullare
   la conferma preparata.
5. Aprire **Cronologia**. Atteso: storico dei piani/concessioni e registro
   amministrativo presenti insieme; la concessione precedente resta visibile.
6. Ricaricare la pagina in Cronologia. Atteso: stessa scheda selezionata,
   nuova lettura server, nessuna scrittura. Usare Indietro/Avanti del browser:
   devono tornare alle schede visitate. Il refresh completo non conserva
   una modifica non salvata; la conservazione vale per il cambio scheda.
7. Restringere la finestra a circa 390 px. Atteso: schede raggiungibili con
   scorrimento orizzontale, campi in colonna, tabelle scorrevoli; usare Tab
   e Invio per cambiare scheda da tastiera. Nessun dato nascosto diventa
   visibile fuori dalla propria scheda.
8. Su un'azienda ancora `migration_pending`, verificare che il Riepilogo
   mostri il conteggio corrente e limiti Non assegnati, senza valori
   inventati. In Gestione preparare una classificazione: la sola etichetta
   non assegna un piano.

## Esito da registrare

- [x] SQL/RLS, 6 suite concorrenti, 281 test client, tipi, lint e build locali.
- [x] Correzione menu di classificazione: regressione riprodotta e risolta; 282 test client, typecheck web, lint e build passano.
- [x] Scheda azienda e letture M06a mostrate dall'utente sul progetto attuale.
- [x] Utente: concessione Team/una sede/2048 MiB a Da Buffa, con periodo e audit visibili.
- [x] Riordino UI: 291 test client, typecheck web, lint e build passano.
- [ ] Rilascio e prova visuale delle quattro schede, URL e conservazione della modifica preparata.
- [ ] Verificare manualmente le quattro scelte nei menu di classificazione di Aziende e Account.
- [x] Dashboard e nuove RPC disponibili nel progetto ospitato: scheda e concessione mostrate dall'utente; nessun rilascio eseguito da Codex.
- [ ] Prove visuali di classificazione, concessione, variazione e registro.
- [ ] Conferma vecchia, retry di rete e diniego con account fuori allowlist.
- [ ] Storico/export conservati dopo l'assegnazione e la variazione.

M06a non chiude M06 né abilita i pagamenti. Quota dichiarata e quota applicata
restano distinte; economia/costi rimangono Non disponibili finché mancano
registro e fonti verificate.
