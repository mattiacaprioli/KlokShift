# Verifica manuale M03b e collegamento iniziale del client

Blocco del 5 ottobre 2026. Migration nuove `20261005000200`–`20261005000500`;
nessuna migration pubblicata riscritta. Il banco SQL e l'interfaccia usano
ambienti diversi. Questa procedura non effettua deploy in produzione.

## 1. Banco SQL locale riproducibile

Dalla root `/Users/alisher/KlokShift`, con Docker attivo:

```sh
supabase/tests/run.sh up
supabase/tests/run.sh reset
supabase/tests/run.sh test
supabase/tests/gen-types.sh
yarn test:unit
yarn typecheck
yarn web:typecheck
CI=1 yarn lint
yarn web:build
CI=1 yarn expo export --platform ios --output-dir /tmp/klokshift-m03b-ios
```

`reset` ricostruisce **soltanto `klokshift-pg`**, porta 54422, eliminando le
fixture locali. Ripartire da `reset` prima di ripetere l'intero gate: le vecchie
suite concorrenti possono lasciare cambi alle fixture comuni. Il container
non offre Auth/REST/Storage HTTP: non inserire la sua porta come URL dell'app.

Risultati attesi: tutte le suite SQL/RLS passano, inclusa
`080_commercial_enforcement.sql`; tutte le suite concorrenti passano, inclusa
`050_commercial_capacity.sql`, con un solo vincitore all'ultimo posto di persone
e sedi, anche nella gara fra riapertura e aggiunta. I client passano typecheck/test; lint senza errori (rimane il warning
preesistente di `watch` in `web/src/shifts/ShiftPanel.tsx`).

Gli scenari SQL coprono conteggio unico su due sedi, invito già riservato,
ambito ristretto, 31ª persona, riapertura con persone che tornano a contare,
scadenza senza cron, scritture dirette e Storage, rettifiche pregresse,
timbratura aperta/approvazione, sedi tutte chiuse, dati di oltre dodici mesi,
fine archivio, revoche e un'altra azienda ancora operativa.

## 2. Ambiente per la prova visuale

Usare un **progetto Supabase dev isolato e sacrificabile**, con Auth, REST e
Storage effettivi. Il progetto `rmlobxjlqlpixkvrzmfg` usato dalla produzione
non è il banco di questa procedura. In questa sessione non sono stati creati
progetti o applicate migration remote.

Sul solo dev, applicare tutte le migration mancanti nell'ordine dei timestamp,
indicando esplicitamente il database dev, senza affidarsi al progetto CLI già
collegato. Dal pannello **Connect** di quel progetto copiare la connection string
Postgres (password codificata come richiesto nell'URL):

```sh
export KLOKSHIFT_DEV_DATABASE_URL='CONNECTION_STRING_DEL_SOLO_DEV'
yarn -s supabase db push --db-url "$KLOKSHIFT_DEV_DATABASE_URL" --dry-run
yarn -s supabase db push --db-url "$KLOKSHIFT_DEV_DATABASE_URL"
```

Il dry-run di un dev già a M03a deve elencare soltanto le quattro nuove migration;
verificare anche che l'identificativo del dev nella connection string corrisponda
a quello dell'URL usato dai client. Una baseline già registrata non va riapplicata
né modificata. Per
un dev nuovo si applica l'intera cartella `supabase/migrations/`, non i file in
`migrations_legacy/` e non `supabase/tests/bootstrap.sql`/`seed.sql`.

Nella root preparare `.env.local` (non commetterlo):

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://ID_DEL_SOLO_DEV.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=CHIAVE_PUBBLICA_DEL_SOLO_DEV
```

Riavviare Metro/Vite dopo il cambio di ambiente:

```sh
yarn web:dev
yarn start --clear
```

Aprire l'URL locale stampato da Vite e una development build nativa collegata a
Metro. Creare due account **di test** nel dev: titolare e professionista, con
email confermata. Si può confermare un account di fixture tramite Auth admin;
non disattivare «Confirm email». Per la verifica delle revoche aggiungere un
terzo professionista di test e promuoverlo a collaboratore dalla sua scheda
già collegata all'azienda. Invitare i professionisti che hanno
già un account tramite email e accettare dall'app: non occorre configurare
l'invio email Edge per questa variante.

Nel SQL editor del solo dev recuperare gli identificativi delle fixture:

```sql
select id, name from public.workspaces order by created_at desc;
select id, workspace_id, name, closed_at from public.venues order by created_at desc;
select id, workspace_id, user_id, display_name, authority, status
from public.workspace_members order by created_at desc;
```

Negli esempi sostituire `WS_TEST` con l'UUID dell'azienda di fixture. Gli UUID
vanno fra apici SQL. Le concessioni e le modifiche alle date si eseguono dal SQL
editor amministrativo del dev, mai dalla sessione normale del cliente.

## 3. Setup e prova unica

1. Aprire un'azienda dal nuovo account titolare e creare la prima sede.
2. In Home/profilo dell'app o nel banner della dashboard compare **setup**:
   preparare la prima sede e avviare la prova. Nuovi turni e nuove persone non
   sono ancora autorizzati; una seconda sede è rifiutata dal server.
3. Premere **Avvia la prova di 30 giorni**. Risultato: prova Team, una sede,
   fine operatività a trenta giorni dall'attivazione server; nessun checkout.
4. Creare un turno e aggiungere una persona: riescono. Tentare una seconda
   sede: messaggio di capacità raggiunta, nessun addebito o sede aggiunta.
5. Ricaricare la pagina e riaprire l'app: inizio/fine prova invariati. Il test
   SQL verifica anche retry simultanei e trasferimento del titolare.

## 4. Capacità Base e concessione gratuita

Dal SQL editor dev:

```sql
select public.grant_workspace_access(
  'WS_TEST', 'complimentary_lifetime', 'base', 2,
  now(), null, 'Fixture manuale M03b: Base, due sedi'
);
```

1. Premere **Aggiorna stato**. Compaiono Base, due sedi, persone su 30 e
   gratuità operativa senza scadenza; non nasce un pagamento.
2. Creare la seconda sede. Aggiungere trenta persone uniche, contando anche
   gli inviti e gli eventuali titolari/collaboratori già in organico.
3. Collegare una persona esistente anche all'altra sede: il numero non aumenta.
   Un gestore senza organico non aggiunge un posto.
4. A 28/30 persone compare l'avviso. La 31ª aggiunta fallisce; persone/turni
   già presenti continuano a funzionare.
5. Chiudere una sede con persone presenti soltanto lì: l'uso diminuisce, i dati
   restano nello storico. Occupare i posti liberati nell'altra sede, poi
   tentare la riapertura: è rifiutata se riporta l'azienda oltre 30.
6. Rimuovere una persona e riprovare quando la capacità è compatibile:
   riapertura riuscita. Nessun rimborso/stop contratto è implicito nella chiusura.

## 5. Scadenza e rettifiche pregresse

Usare una seconda azienda di fixture con **solo la prova**, senza concessione
permanente (la gratuità permanente ha precedenza sulla prova). Prima della
scadenza creare:

- un turno passato, con professionista assegnato, per rettificare le ore;
- un turno di domani già assegnato;
- un turno iniziato poco prima di adesso e con fine fra circa un'ora, metodo
  App, sul quale il professionista ha già timbrato l'entrata;
- un documento di prova, per verificare il download dopo la scadenza.

Accorciare soltanto il periodo di fixture:

```sql
update public.workspace_access_periods
set ends_at = now() + interval '90 seconds'
where workspace_id = 'WS_TEST' and kind = 'trial';
```

Premere **Aggiorna stato**, poi attendere oltre la data mostrata:

1. Il client passa ad archivio anche senza navigare. Fine operatività, termine
   archivio a dodici mesi di calendario e termine rettifiche a sette giorni
   sono mostrati separatamente, in ora italiana.
2. Gli ingressi principali per nuovi turni e persone sono assenti. Anche un
   form rimasto aperto o una chiamata diretta viene rifiutato dal backend:
   creazione/modifica/spostamento turni, assegnazioni/conferme future,
   nuovi membri, mansioni e nuovi upload.
3. Rettificare le ore del turno passato: riesce con i permessi Ore. Rettificare
   il turno di domani: rifiuto, anche se assegnato prima della scadenza.
4. Chiudere l'entrata già aperta: riesce entro la finestra di sette giorni e
   prima di **fine turno + 24 ore**; il gestore può approvarla. Nuova entrata
   negata. Una correzione non può spostare l'inizio dopo fine operatività o
   l'uscita oltre il limite del turno.
5. Download del documento, storico e CSV/PDF delle ore funzionano nei permessi
   originari. Il testo della chat resta disponibile durante l'archivio; nuove
   richieste di assenza/cambio turno sono negate. Revoca collaboratore,
   riduzione permessi/ambito e uscita restano possibili.
6. Login, export e rettifica non cambiano `operational_until`/`archive_until`.
   Il professionista vede i propri dati consentiti, non tutto il fascicolo HR.

Per verificare il termine rettifiche senza aspettare sette giorni:

```sql
update public.workspace_access_periods
set starts_at = now() - interval '40 days', ends_at = now() - interval '8 days'
where workspace_id = 'WS_TEST' and kind = 'trial';
```

Aggiornare lo stato: rettifiche negate, storico/download/export ancora
consultabili. Non aggiungere concessioni per simulare una tolleranza di rinnovo:
Paddle e la grazia finanziaria non sono implementati in questo blocco.

## 6. Storico completo e fine consultazione

1. Nel dev preparare un turno/ore di fixture di oltre tredici mesi fa. Chiudere
   tutte le sedi dall'azienda ancora in archivio.
2. Nell'app aprire Home o Profilo → **Storico turni** / **Ore ed export** nella
   carta dello stato: gli ingressi restano presenti anche senza sedi aperte.
   Sul web usare le voci **Storico** e **Ore** del menu. I turni delle sedi chiuse
   sono presenti. Aprire **Ore**
   sul web, scegliere quel mese nel campo mese: CSV/PDF includono le ore
   autorizzate. Le ore riconosciute restano separate da quelle lavorate.
3. Un collaboratore vede solo le sedi e i dati ammessi dai suoi permessi.
4. Portare il periodo di prova a fine operatività oltre dodici mesi fa:

```sql
update public.workspace_access_periods
set starts_at = now() - interval '15 months', ends_at = now() - interval '13 months'
where workspace_id = 'WS_TEST' and kind = 'trial';
```

Aggiornare lo stato: **consultazione terminata**; nuove letture DB/Storage e
report RPC non restituiscono i dati operativi di quella azienda. Anche apertura
thread e nuovi messaggi sono negati. I dati non sono
cancellati automaticamente: job, avvisi e cancellazione verificata sono M11.
I file già scaricati e URL firmati già emessi hanno il loro ciclo (gli URL
firmati del data layer durano 60 secondi).

## 7. Compatibilità di `migration_pending`

Usare un'altra azienda di test senza periodi, con il titolare attivo:

```sql
update public.workspace_commercial_state
set migration_review_required = true
where workspace_id = 'WS_TEST';
```

1. Aggiornare lo stato: «configurazione in verifica, puoi continuare a lavorare».
   Nessun piano/capacità/scadenza viene mostrato come acquisito.
2. Aggiungere sede, persona e turno: il comportamento precedente è conservato.
   `start_workspace_trial` è rifiutata: nessuna prova retroattiva.
3. Verificare nel SQL editor che non sia apparso alcun periodo commerciale.
4. Assegnare una concessione **esplicita** tramite `grant_workspace_access`:
   dopo aggiornamento si applicano capacità e scadenze di quel periodo.
5. Il test SQL copre anche l'assenza della riga commerciale: viene rifiutata,
   senza trattarla come `migration_pending` o capacità infinita.

La compatibilità non è una gratuità permanente né una finestra con date
inventate. La classificazione delle aziende reali e il rollout remoto restano
un passaggio separato, con elenco/date espliciti autorizzati dal fondatore.

## 8. Refresh e confini ancora aperti

Provare ritorno dal background, focus del browser, reconnect e **Aggiorna
stato** dopo una concessione amministrativa. Una risposta mancante/invalida o
un errore di refresh non sblocca nuova operatività. Le date dei timer sono
calibrate sull'istante server: un orologio locale avanti non genera un loop di
retry. I test client verificano anche il prossimo inizio di concessione futura.

Le tabelle commerciali non hanno un nuovo realtime globale. Una variazione
amministrativa mentre il client rimane visibile viene recepita al prossimo
refresh/focus/reconnect; i controlli DB sono immediatamente autorevoli.

Restano M05/M06 (dashboard del fondatore, MFA e audit delle azioni), M04 completo
(flussi commerciali web, sito e affinamento dei form), M09 (Paddle) e M11
(avvisi, restituzione completa dei dati e cancellazione). La quota documenti
aziendale, la capacità futura del downgrade e la grazia di rinnovo richiedono
il loro modello verificato; questo blocco non li simula. Le regole di conteggio
continuano quelle del motore M03a; i dettagli commerciali residui nei documenti
canonici non vengono dichiarati approvati da questa implementazione.
