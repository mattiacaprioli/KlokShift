# Verifica manuale della dashboard del fondatore — M05

Blocco del 6 ottobre 2026: nuova migration `20261006000100_platform_admin_reads.sql`.
Area web di **consultazione** a `#/amministrazione`. Nessuna migration pubblicata
riscritta; nessun deploy o provisioning di un amministratore reale eseguito da
questa sessione. Concessioni/modifiche, audit, spese e pagamenti sono step successivi.

## 1. Verifica riproducibile nel banco SQL locale

Dalla root `/Users/alisher/KlokShift`, con Docker attivo:

```sh
supabase/tests/run.sh up
supabase/tests/run.sh reset
supabase/tests/run.sh test
supabase/tests/gen-types.sh
yarn test:unit
yarn typecheck
yarn web:typecheck
yarn site:typecheck
CI=1 yarn lint
yarn web:build
CI=1 yarn expo export --platform ios --output-dir /tmp/klokshift-m05-ios
```

`reset` elimina soltanto le fixture del container `klokshift-pg`, porta 54422.
Ripartire da reset prima di ripetere l'intera suite concorrente. Questo container
non offre Auth/REST/Storage HTTP: **la porta 54422 non è l'URL dell'app**.
`bootstrap.sql` riproduce le colonne Auth necessarie alle fixture di sessione e
fattori; non va applicato su Supabase dev o produzione.

Risultati attesi: 14 file SQL/RLS e 5 suite concorrenti passano, compreso
`090_platform_admin.sql`; 38 file / 272 test client passano. Typecheck e build
passano; lint senza errori, con il warning preesistente di React Hook Form in
`web/src/shifts/ShiftPanel.tsx`. Il build web segnala la dimensione del bundle.

La suite verifica allowlist, `aal2`, fattore verificato ancora presente, sessione
ancora valida, revoca, logout, scadenza sessione, account bloccato/eliminato/email
non confermata; un titolare con MFA resta escluso se fuori allowlist. Verifica
anche paginazione, ricerca letterale, conteggi Auth distinti da profili residui
e schede manuali, Storage misurato, `migration_pending`, dato commerciale
mancante e archivio che non si prolunga alla lettura. I test del gate verificano
che nessuna query globale parta prima dell'autorizzazione iniziale.

## 2. Preparare un Supabase dev completo e isolato

La prova visuale richiede un **progetto dev sacrificabile** con Auth, REST e
Storage effettivi. Non usare il progetto di produzione `rmlobxjlqlpixkvrzmfg`.
Non sono state usate credenziali dev o applicate migration remote in questa
sessione: i passi seguenti sono la verifica manuale ancora da eseguire.

1. Dal pannello Connect del progetto dev copiare la connection string Postgres.
2. Applicare le migration mancanti indicando esplicitamente quel database:

```sh
export KLOKSHIFT_DEV_DATABASE_URL='CONNECTION_STRING_DEL_SOLO_DEV'
yarn -s supabase db push --db-url "$KLOKSHIFT_DEV_DATABASE_URL" --dry-run
yarn -s supabase db push --db-url "$KLOKSHIFT_DEV_DATABASE_URL"
```

Su un dev già aggiornato a M03b il dry-run deve elencare soltanto
`20261006000100_platform_admin_reads.sql`. Su un dev precedente applicare anche
le migration mancanti, in ordine, senza riscrivere o riapplicare quelle registrate.
Per un dev nuovo usare la cartella `migrations/`, mai `migrations_legacy/` o il
bootstrap/seed del banco SQL. La allowlist nasce **vuota**.

3. In Auth mantenere **Confirm email attivo** e TOTP MFA abilitato. Autorizzare
   i redirect localhost necessari alla conferma email secondo la configurazione
   già usata dai flussi di registrazione. Creare e confermare account di prova
   distinti: fondatore, titolare cliente, collaboratore e professionista.
   Il fondatore può non appartenere ad alcuna azienda.
4. In Auth → Users copiare l'UUID dell'account fondatore **del dev**; nel SQL
   Editor dello stesso progetto eseguire, sostituendo il segnaposto UUID:

```sql
select id,email,email_confirmed_at,deleted_at
from auth.users where id='UUID_FONDATORE_DEV'::uuid;

insert into private.platform_admins(user_id,reason)
values ('UUID_FONDATORE_DEV'::uuid,'Provisioning esplicito fondatore — prova M05 dev');
```

Controllare che email e conferma appartengano all'account scelto. Non cercare
l'amministratore per `authority=owner`, primo registrato o metadata; non aggiungere
gli altri account. Non creare manualmente sessioni o fattori verificati su questo
dev: li deve produrre il login/Auth reale.

5. Avviare Vite con **URL e chiave pubblica del dev** come variabili del processo:

```sh
EXPO_PUBLIC_SUPABASE_URL='https://REF_DEV.supabase.co' \
EXPO_PUBLIC_SUPABASE_ANON_KEY='CHIAVE_PUBBLICA_DEV' yarn web:dev
```

Usare l'URL localhost stampato da Vite, normalmente
`http://localhost:5173/#/amministrazione`. Non cambiare il `.env` di produzione
e non inserire service-role key. In una finestra privata evitare sessioni
conservate per un altro progetto. Verificare nella scheda Network che le richieste
vadano all'URL dev scelto.

## 3. Login e secondo fattore

| Passaggio | Risultato atteso |
|---|---|
| Aprire `#/amministrazione` senza sessione | Login; dopo l'accesso resta il percorso amministrativo |
| Entrare come fondatore appena provisionato | «Verifica del fondatore»; nessuna richiesta `admin_get_overview` / `admin_list_*` prima del secondo fattore |
| Cliccare «Configura secondo fattore» | QR e chiave per l'app di autenticazione, senza dati globali |
| Scansionare il QR con un'app TOTP e inserire un codice sbagliato | Errore italiano; l'area resta chiusa |
| Inserire il codice corrente corretto | Panoramica, menu Aziende e Account; il fondatore non deve avere un'azienda cliente per entrare |
| Uscire e accedere di nuovo | Nuovo challenge con il fattore già verificato; nessun QR nuovo richiesto |
| Annullare una configurazione nuova non verificata | Il fattore appena creato viene rimosso, si può ripartire |
| Ricaricare durante una configurazione incompleta | Il segreto non viene ripristinato dal browser; la configurazione incompleta è elencata e si può rimuovere esplicitamente prima di ripartire |

Il browser conserva normalmente la sessione Auth; non conserva nella cache
amministrativa il codice TOTP, il QR o la chiave di configurazione. Il controllo
periodico rilegge **solo lo stato di accesso**, ogni 60 secondi mentre l'area è
visibile. Non ricarica automaticamente tutti i riepiloghi. Refresh del token,
focus, reconnect e «Aggiorna» verificano nuovamente l'accesso; ogni RPC globale
ricontrolla i permessi sul server, indipendentemente dall'interfaccia.

## 4. Preparare dati riconoscibili e verificare i conteggi

Sul dev creare tramite i flussi cliente almeno due aziende e tre sedi. Usare un
account in due aziende, un titolare/collaboratore che lavora anche in organico,
una scheda manuale senza account e un invito pendente. Se necessario assegnare
accesso alle sole fixture con il percorso service/SQL descritto nella procedura
[M03b](TEST-MONETIZATION-M03B.md); non dedurre concessioni dal vecchio piano.

La classificazione amministrativa è esplicita e **non cambia l'accesso commerciale**.
Per distinguere una fixture dal cliente, dal solo SQL Editor dev:

```sql
insert into private.admin_workspace_labels(workspace_id,classification,reason)
values ('UUID_AZIENDA_FIXTURE'::uuid,'test','Fixture per verifica M05');
insert into private.admin_account_labels(user_id,classification,reason)
values ('UUID_FONDATORE_DEV'::uuid,'internal','Account interno di prova');
```

| Passaggio | Risultato atteso |
|---|---|
| Aprire Panoramica | Account reali Auth separati da membri, collocazioni e gestori; sedi aperte e chiuse distinte |
| Cercare azienda per nome, nome scheda del gestore o email del gestore | Risultati dal server; `%` e `_` sono testo letterale, non wildcard |
| Filtrare stato, piano e classificazione | Solo risultati compatibili; aziende senza etichetta «Non classificato» |
| Creare oltre 25 account/aziende fixture o membri e usare Successivi/Precedenti | Pagine di 25 elementi, totale corretto, senza scaricare tutti i dettagli nel browser |
| Aprire l'azienda con la persona in due sedi | Conteggio commerciale unico per persona aziendale; due collocazioni restano distinte |
| Aprire Account e il dettaglio dell'account in due aziende | Un account, due appartenenze, authority/stato/ambito e sedi di lavoro distinti |
| Aprire una scheda manuale nel dettaglio azienda | «Scheda senza account collegato»; non aumenta il numero di account Auth |
| Confrontare date di prova/concessione con i periodi DB | Date reali in Europe/Rome; gratuità permanente senza scadenza; nessun pagamento inventato |
| Aprire i pannelli Economia e costi | «Non disponibili», senza MRR/incassi/utile/costi pari a zero presunti |

Nel dettaglio account ogni appartenenza limita a 25 le sedi gestite e le
collocazioni riportate, con totale e avviso esplicito se troncate. Le liste di
appartenenze e le sezioni aziendali hanno paginazione autonoma. Non sono presenti
comandi per concedere gratuità o cambiare capacità: appartengono a M06.

## 5. Migrazione e archivio: prova senza effetti commerciali

Usare soltanto aziende fixture già preparate per M03b. Per uno scenario
`migration_pending`, sul dev scegliere una fixture **senza periodi validi** e
impostare esplicitamente `workspace_commercial_state.migration_review_required=true`.
Per uno scenario archivio usare la concessione temporanea scaduta descritta
nella procedura M03b. Non alterare aziende o concessioni reali.

1. Aprire la fixture `migration_pending`: compare «Migrazione da verificare»,
   piano non assegnato e capacità «da verificare». Una classificazione `test`
   o `customer` non risolve la migrazione e non assegna diritti.
2. Con il titolare della stessa fixture verificare che le operazioni precedenti
   continuino secondo l'eccezione M03b. La lettura admin non deve bloccarle.
3. Aprire la fixture in archivio: fine operatività, finestra rettifiche e fine
   archivio sono separate. Salvare il valore di `archive_until`, fare refresh,
   logout/login e consultare di nuovo: deve rimanere identico.
4. Dal client titolare confermare lettura/export dello storico e sedi chiuse
   secondo la procedura M03b. Il fondatore vede i soli metadati, non i documenti
   HR o le chat di quella fixture.
5. Solo su una fixture sacrificabile, rimuovere la riga commerciale dal SQL
   Editor: l'admin mostra «Dati mancanti» e una segnalazione critica; non assegna
   Team, trial o capacità infinite. Le operazioni cliente devono fallire secondo
   i guard M03b, invece di sbloccarsi per dato assente.

## 6. Spazio e anomalie

1. Da un'azienda operativa fixture caricare un documento consentito. In admin
   verificare il numero oggetti e confrontare i byte con `storage.objects.metadata.size`
   sul dev. I valori non provengono da `staff_documents.size_bytes`.
2. Se il metadata di un oggetto fixture è privo di dimensione, il conteggio
   «dimensioni sconosciute» deve aumentare; il totale dei byte noti è parziale.
   Un file non associabile a un membro aumenta i «non attribuiti» globali, senza
   inventare l'azienda di appartenenza. Queste anomalie sono già simulate nel banco SQL.
3. Con una fixture Base a 28 persone, una prova vicina alla fine o un archivio
   con meno di 30 giorni residui, controllare titolo, gravità, fonte e data della
   segnalazione. Le prime 20 sono nella panoramica; i dettagli aziende conservano
   tutte quelle disponibili. Non sono notifiche già inviate o problemi risolti.

Questa misura riguarda il bucket `staff-documents`, non tutto lo Storage,
traffico o fattura Supabase. Quote/avvisi 80–90% e costi per azienda non sono
implementati da M05.

## 7. Dinieghi diretti e revoca

In finestre private separate provare titolare, collaboratore e professionista:
`#/amministrazione` deve mostrare «Area riservata al fondatore», senza query
globali. Provarne almeno uno con MFA attivo: rimane escluso dalla allowlist.

Per verificare anche le API senza dipendere dal gate, usare la Console del
browser **sul dev**. Copiare solo la chiave pubblica e il riferimento progetto;
non stampare né copiare in chat il token di sessione:

```js
const devUrl = 'https://REF_DEV.supabase.co';
const devPublicKey = 'CHIAVE_PUBBLICA_DEV';
const devSession = JSON.parse(localStorage.getItem('sb-REF_DEV-auth-token') ?? 'null');
const devResponse = await fetch(`${devUrl}/rest/v1/rpc/admin_get_overview`, {
  method: 'POST',
  headers: {
    apikey: devPublicKey,
    Authorization: `Bearer ${devSession.access_token}`,
    'Content-Type': 'application/json',
  },
  body: '{}',
});
const devResult = await devResponse.json();
({ status: devResponse.status, message: devResult.message ?? 'Risposta autorizzata' });
```

Risultato atteso: `admin_not_allowed` per tutti gli account fuori allowlist;
`admin_mfa_required` per il fondatore prima del challenge; HTTP 200 con MFA e
allowlist validi. Ripetere cambiando endpoint in `admin_list_workspaces`,
`admin_list_accounts`, `admin_get_workspace` (body `{"p_workspace":"UUID_FIXTURE"}`)
e `admin_get_account` (body `{"p_account":"UUID_FIXTURE"}`). Un token anon non può
eseguire neppure `get_platform_admin_access`. Con key anon JWT si può provare
usando quella key come Bearer; con key pubblica nuova usare la richiesta senza
Authorization, secondo il gateway dev. Atteso diniego e nessun dato globale.

Con il fondatore già dentro, dal SQL Editor **dev**:

```sql
update private.platform_admins set revoked_at=now()
where user_id='UUID_FONDATORE_DEV'::uuid;
```

La RPC deve essere negata **subito**, anche col JWT corrente. Premendo Aggiorna,
rientrando sul tab o entro il controllo di 60 secondi, l'area deve chiudersi e
la cache amministrativa essere rimossa. La revoca non modifica le appartenenze
cliente. Per continuare la prova ripristinare esplicitamente `revoked_at=null`
sul solo dev, poi accedere di nuovo.

Provare anche logout e successivo login di un cliente nello stesso browser:
nessun riepilogo del fondatore deve riapparire. Disconnettendo la rete e premendo
Aggiorna devono comparire errore/riprova, senza presentare i vecchi dati come
verificati. Non lasciare un token MFA o una concessione admin di test in produzione.

## Esito da registrare prima del rollout

- [x] SQL/RLS/concorrenza, API/parser/cache, gate web, tipi, lint e bundle locali.
- [ ] Login Auth reale, enrollment QR, challenge corretto/errato e ripresa configurazione incompleta su dev.
- [ ] Smoke visuale multiutente, filtri/pagine, date/spazio e confronto con DB dev.
- [ ] Revoca allowlist con JWT ancora valido, logout/cambio account e reconnect su dev.
- [ ] Provisioning dell'unico fondatore reale e rollout deliberato, dopo il gate dev.

M05 non abilita il lancio pagante. Seguono concessioni/audit M06, flussi
commerciali M04, Paddle e ciclo completo di archivio/cancellazione.
