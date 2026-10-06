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

Atteso: 15 file SQL/RLS e 6 suite concorrenti passano; 39 file / 281 test
client passano; tipi, lint e build web passano. Restano il warning React Hook
Form preesistente in `ShiftPanel.tsx` e l'avviso sulla dimensione del bundle.

Verifica eseguita il 6 ottobre 2026: tutti questi controlli passano. Le tre
nuove gare concorrenti passano contro sessioni Postgres distinte; non si
tratta di una simulazione lato client. Auth/TOTP e prove visuali ospitate
restano da eseguire dopo il rilascio.

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

Prima del rilascio, il sito pubblico mostra ancora M05 e le nuove RPC M06a
non sono disponibili. Non basta avviare il nuovo frontend locale se è collegato
a un DB ospitato privo della nuova migration.

## 3. Classificare senza concedere diritti

1. Aprire [area del fondatore](https://klokshift.com/app/#/amministrazione)
   con l'account abilitato e verificare il secondo fattore.
2. Aprire **Aziende → Bar Teatro** (o una sola azienda propria scelta).
3. Nel pannello **Interventi del fondatore**, scegliere **Classificazione**,
   nuova etichetta **Test**, motivo `Azienda personale di test preesistente`.
4. Premere **Rivedi intervento**. Atteso: riepilogo della sola etichetta,
   senza modifica di piano, prova o scadenze.
5. Premere **Conferma intervento**. Atteso: etichetta Test e una riga nel
   registro con motivo, attore, data e identificativo.
6. Verificare che l'azienda resti **Migrazione da verificare**, piano non
   assegnato, nessuna prova creata. L'altra azienda mantiene la sua etichetta.

## 4. Assegnare una gratuità a vita

1. Nella stessa scheda scegliere **Gratuità a vita / variazione capacità**.
2. Per un'azienda con una sede aperta e meno di 31 persone, scegliere
   **Base**, **1 sede gratuita totale**, **2048 MiB**, motivo
   `Concessione personale per verifica M06a`. Se l'uso noto supera questi
   valori, scegliere capacità compatibili: nessun dato viene eliminato.
3. Premere **Rivedi intervento**. Atteso: azienda destinataria dalla scheda,
   piano, sedi totali, quota dichiarata, decorrenza immediata alla conferma,
   assenza di scadenza commerciale/carta/rinnovi e motivo.
4. Premere **Conferma intervento**. Atteso:
   - azienda Operativa, origine Gratuito a vita, piano Base;
   - limite persone 30 e sedi 1, quota dichiarata 2048 MiB;
   - nessuna fine operatività/archivio inventata;
   - nuovo periodo senza scadenza e nuova riga nel registro;
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
   Atteso: capacità 2, una concessione permanente corrente; il periodo
   precedente rimane visibile con la revoca e il motivo originale.
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

## Esito da registrare

- [x] SQL/RLS, 6 suite concorrenti, 281 test client, tipi, lint e build locali.
- [ ] Rilascio della nuova migration e dashboard sul progetto ospitato.
- [ ] Prove visuali di classificazione, concessione, variazione e registro.
- [ ] Conferma vecchia, retry di rete e diniego con account fuori allowlist.
- [ ] Storico/export conservati dopo l'assegnazione e la variazione.

M06a non chiude M06 né abilita i pagamenti. Quota dichiarata e quota applicata
restano distinte; economia/costi rimangono Non disponibili finché mancano
registro e fonti verificate.
