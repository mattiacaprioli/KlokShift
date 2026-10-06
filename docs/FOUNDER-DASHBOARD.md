# Dashboard personale del fondatore

**Stato, 2026-10-06:** M05 implementato e verificato nel banco locale: allowlist/MFA e guard server, panoramica, aziende e account paginati, dettagli, capacità/date, anomalie disponibili e Storage misurato. La allowlist nasce vuota; provisioning reale e smoke Auth/TOTP/visuale su dev sono ancora da eseguire. Nessun rollout remoto in questa sessione. Concessioni, audit ed economia M06 e integrazione Paddle restano da realizzare. Procedura precisa: [TEST-FOUNDER-M05.md](TEST-FOUNDER-M05.md).

Questo documento è la fonte dedicata per requisiti, dati, autorizzazioni e verifiche della dashboard personale di Alisher. Le regole commerciali complete sono in [MONETIZATION.md](MONETIZATION.md); dipendenze e sequenza di lavoro sono nel [piano di monetizzazione](../plans/MONETIZATION-AND-FOUNDER-DASHBOARD.md).

## Obiettivo e perimetro

Il fondatore deve capire per ogni cliente: chi gestisce l'azienda, quante sedi e persone usa, quale capacità ha, fino a quando può lavorare, quanto ha pagato e quali interventi sono necessari.

La dashboard è distinta dall'area che le aziende usano per turni, organico e ore. Essere titolare di un'azienda non rende amministratore di KlokShift. Il controllo della piattaforma non richiede la lettura ordinaria di chat, documenti o note HR dei clienti.

La versione essenziale deve essere pronta **prima del primo cliente pagante**, insieme a checkout web, eventi provider verificati, rinnovi, disdetta, archivio ed export. I tester gratuiti possono iniziare prima del completamento dei pagamenti. Grafici avanzati e automazioni secondarie possono seguire il lancio.

## Accesso e architettura

- Riutilizzare `web/`, con layout amministrativo distinto e data layer dedicato; non introdurre un secondo stack frontend.
- Percorso implementato: `#/amministrazione`, nell'HashRouter esistente, prima del gate cliente. Il nome della rotta non è una misura di sicurezza.
- Allowlist in `private.platform_admins`, separata da `workspace_members.authority`; nasce vuota, poi si provisiona esplicitamente soltanto il fondatore. Non dedurre l'identità amministrativa da email, ownership o metadata.
- Richiedere sessione valida e MFA con livello `aal2`; verificare autorizzazione e revoca a ogni richiesta amministrativa.
- Il browser usa chiave pubblica e sessione autenticata. Nessuna service-role key, credenziale provider o segreto amministrativo nel bundle.
- Edge Function e RPC esplicite verificano attore e autorizzazione prima di leggere dati globali o usare credenziali server.
- Conservare dati economici, spese e note private in entità non leggibili dai normali client; esporre soltanto i campi necessari.
- Nessun SQL arbitrario, proxy generico, elevazione tramite `user_metadata` o policy che allarghi ai clienti la visibilità sulle altre aziende.
- Dominio client implementato in `src/features/admin/`, con `api.ts`, parser/tipi, hook e query key `qk.admin` separate per identità e sessione; pagine in `web/src/admin/`. Le pagine non interrogano direttamente Supabase.
- Ricerca paginata, filtri validati nel server e payload contenuti; evitare download dell'intero database per calcolare riepiloghi nel browser.

Il guard M05 richiede email confermata, account non anonimo/bloccato/eliminato,
allowlist non revocata, sessione Auth ancora presente/non scaduta, JWT `aal2` e
fattore verificato ancora presente. `get_platform_admin_access` legge soltanto
lo stato del chiamante anche a `aal1`, per raggiungere il setup/challenge. Le
altre cinque RPC `admin_*` ricontrollano il guard prima di ogni lettura globale.
Il browser non riceve `auth.users` integrale né helper/tabelle private.

Ogni lista contiene 25 elementi nell'interfaccia (massimo 50 nelle RPC). Membri,
sedi e periodi aziendali sono paginati separatamente; sedi gestite/collocazioni
nella singola appartenenza account sono limitate a 25 con totale e avviso.
Il controllo di accesso ogni 60 secondi legge solo lo stato del chiamante,
senza polling globale. Errori di verifica accesso/revoche/uscita rimuovono i dati amministrativi
dalla cache; un cambio token richiede una nuova verifica prima delle pagine.

La misura spazio M05 usa `storage.objects.metadata.size` del bucket
`staff-documents`: byte noti, dimensioni sconosciute e oggetti non attribuibili
sono distinti. Non espone nomi/percorso/contenuto dei file e non stima costi.
Etichette `customer/internal/test` in tabelle private sono esplicite e motivate;
senza etichetta rimane `unclassified`, anche per una concessione gratuita.
Non risolvono `migration_pending` né modificano periodi commerciali.

## Pagine della versione essenziale

| Pagina | Contenuto richiesto |
|---|---|
| Panoramica | Aziende per stato commerciale, account reali, sedi aperte/chiuse, organico, pagamenti, costi, cassa e attività urgenti |
| Aziende | Ricerca per denominazione/referente, stato, piano, ciclo, capacità/uso, date, provenienza e segnalazioni |
| Scheda azienda | Titolari e collaboratori, sedi, conteggi, contratto, concessioni, date, pagamenti, archivio e cronologia amministrativa |
| Account | Registrazione/conferma disponibili, aziende collegate, authority e stato per azienda, sedi gestite e sedi dove la persona lavora |
| Contratti e pagamenti | Voci base/extra, periodi coperti, pagamenti verificati/attesi, rimborsi, contestazioni, documenti e riferimenti provider |
| Payout | Trasferimenti del provider attesi/ricevuti, commissioni e rettifiche riconciliabili |
| Spese | Fornitore, categoria, data, valuta, importo, quota progetto, periodo di competenza, pagamento e riferimento documento |
| Scadenze e anomalie | Prove, grazia, rinnovi, pause, downgrade, archivio, uso spazio, richieste di recupero ed errori di sincronizzazione |
| Registro amministrativo | Attore, azione, destinatario, timestamp, motivo, esito e variazioni essenziali |

Ogni pagina deve gestire caricamento, assenza dati, errore e aggiornamento. Un dato sconosciuto appare come «Non disponibile»; un pagamento atteso non appare come incassato.

## Scheda azienda

La scheda deve presentare in modo distinto:

1. Identità commerciale, referenti verificati, origine del cliente e classificazione interna/test.
2. Piano/versione, ciclo, capacità organico, sedi incluse/extra/concesse e uso corrente.
3. Accesso operativo, eventuale motivo di sola lettura, grazia e possibilità di riattivazione.
4. Contratto provider, periodi pagati, rinnovo richiesto/confermato e variazioni programmate.
5. Prova e proroghe, concessioni gratuite, capacità e motivazioni degli interventi.
6. Pagamenti/rimborsi/contestazioni e documenti commerciali, senza esporre dati della carta.
7. Pausa o uscita, fine operatività, termine archivio, cancellazione prevista/eseguita e relativo esito.
8. Uso documenti, anomalie tecniche/commerciali, richieste di assistenza e registro amministrativo.

Le sedi chiuse restano visibili come storico; distinguerle dalle sedi aperte che consumano capacità. L'elenco delle persone mostra i dati minimi per capire appartenenza, autorità e conteggio, senza aprire automaticamente le schede HR.

## Definizioni dei conteggi

| Voce | Regola |
|---|---|
| Account | Account Auth effettivi; distinguere confermati, non confermati, eliminati e test. Il numero grezzo di `profiles` non è sufficiente |
| Membro aziendale | Una persona in `workspace_members`, anche senza account collegato; può essere titolare, collaboratore o dipendente |
| Appartenenza a una sede | Una riga `venue_members`; la stessa persona può averne più di una |
| Organico conteggiato | Persone uniche nell'intera azienda secondo la regola commerciale; la stessa persona in più sedi conta una volta |
| Gestori | Titolari/collaboratori distinti dall'organico; la sola authority non aggiunge un posto dipendente |
| Sedi | Aperte e chiuse separate; capacità acquistata/concessa distinta dal numero effettivo |
| Aziende | Distinguere prova, paganti, gratuite a vita, pausa, uscita in archivio, eliminate e interne/test |

L'inclusione nel conteggio commerciale di schede senza account e inviti che occupano un posto nell'organico segue la regola applicativa ancora da validare in [MONETIZATION.md](MONETIZATION.md). La dashboard deve distinguere questi stati e spiegare il totale secondo la regola definitiva, senza confondere member id e venue member id.

La somma degli organici aziendali può contare la stessa persona in aziende diverse. Non chiamarla «persone uniche nella piattaforma». Una deduplicazione globale delle schede manuali non può essere inventata a partire da nomi o email simili.

## Date e storico

Registrare soltanto date reali, con fonte dichiarata:

- Registrazione/conferma dell'account, creazione azienda, prima sede e prima attivazione quando effettivamente raccolte.
- Inizio/fine prova, proroghe, primo pagamento verificato e periodi coperti.
- Richiesta/decorrenza di pausa, disdetta o downgrade; conferma provider e riattivazione.
- Fine accesso operativo (`operational_until`, nome proposto), termine di grazia e finestra di completamento presenze.
- Termine consultazione/export (`archive_until`), cancellazione prevista/eseguita ed esito dei job.
- Ultima attività disponibile, distinguendo login, creazione di un turno e timbratura.

Istanti in UTC, visualizzazione in Europe/Rome e intervalli con fine esclusiva. I periodi mensili/annuali paganti provengono dal provider; non convertirli in durate fisse di 30/365 giorni.

La consultazione/export dura **12 mesi dalla fine operatività** prevista dalla policy. Login, export, note amministrative e completamento di presenze pregresse non riavviano il termine. Una vera riattivazione segue il flusso commerciale e annulla la cancellazione pendente solo dopo i controlli server.

La dashboard deve distinguere pausa richiesta e pausa efficace: nell'annuale il periodo già acquistato conserva la scadenza, senza congelamento. Fermare il rinnovo e terminare immediatamente l'accesso sono azioni differenti.

I conteggi attuali non ricostruiscono automaticamente il passato. Introdurre snapshot/eventi minimi per i grafici futuri e mostrare «Storico affidabile dal …». Non usare `created_at` come prova retroattiva di prima attivazione o pagamento.

## Economia: ricavi, pagamenti e cassa

| Indicatore | Significato |
|---|---|
| MRR contrattuale | Valore mensile equivalente dei contratti ricorrenti validi, inclusi extra e sconti; annuale diviso 12 |
| Pagamenti clienti | Importi verificati dal provider, con valuta, imposte, sconti e rimborsi separati |
| Vendite tramite MoR | Vendite del provider al cliente finale; indicare il ruolo del MoR e non equipararle automaticamente alle entrate bancarie del progetto |
| Payout | Somme trasferite dal provider; stato atteso/ricevuto, periodo e movimenti di riferimento |
| Costi gestionali | Costi attribuiti al progetto per periodo di competenza, distinti dalle uscite di cassa |
| Cassa del progetto | Entrate effettivamente ricevute meno uscite effettive attribuite al progetto |
| Margine stimato | Ricavi di competenza meno costi attribuiti; criterio dichiarato, prima di imposte personali, contributi e remunerazione del fondatore |

Esempio: Base annuale da 290 € genera MRR di `290 / 12`, circa 24,17 €, e un pagamento anticipato distinto. Prova, beta e gratuità a vita hanno MRR zero. Pause effettive senza periodo ricorrente attivo hanno MRR zero; gli insoluti vanno evidenziati separatamente come ricavo a rischio.

Non sommare vendita al cliente e payout come due entrate del progetto. Non sottrarre nuovamente commissioni già trattenute dal payout. Importi monetari in unità minime con valuta; arrotondare solo in visualizzazione e non aggregare valute diverse senza un criterio esplicito.

Le spese includono infrastruttura, email, dominio, monitoraggio, account store, strumenti, commissioni e consulenze attribuite a KlokShift. Per servizi condivisi dichiarare la quota progetto. Una spesa annuale distingue pagamento iniziale e competenza mensile.

Rettifiche e rimborsi conservano il movimento originale e un collegamento alla correzione. Una nota amministrativa non sostituisce l'esito provider. La dashboard è gestionale: non genera paghe o fatture XML SdI e non promette un risultato fiscale netto.

Il costo per azienda appare come misurato, stimato con criterio oppure non disponibile. Storage, traffico e tempo di assistenza possono guidare la stima; non presentare una ripartizione arbitraria dei costi condivisi come costo esatto del cliente.

## Azioni amministrative

| Azione | Condizioni e risultato |
|---|---|
| Gratuità a vita | Selezione di una specifica azienda, piano, sedi, quota documenti, motivo e decorrenza; beneficio permanente nel perimetro concesso |
| Variazione capacità gratuita | Mostrare capacità corrente/futura, verificare uso e registrare la variazione; nessun extra addebitato implicitamente |
| Proroga prova/grazia | Nuova data limitata e motivo obbligatorio; nessuna estensione automatica a ogni retry o nuova sede |
| Pausa/disdetta | Mostrare decorrenza, periodo conservato e richiesta provider; confermata soltanto dopo esito verificato |
| Riattivazione | Per aziende paganti: prezzo/capacità/periodo accettati e pagamento verificato. Per una concessione gratuita permanente valida: nessun checkout/incasso. In entrambi i casi verificare capacità e cancellazione pendente |
| Cambio piano/sedi | Compatibilità con uso, effetto e decorrenza; il fondatore non crea addebiti senza l'accettazione necessaria del cliente |
| Rimborso/rettifica | Motivo, pagamento originale, importo e stato provider; rendere visibili richiesto, fallito ed eseguito |
| Recupero titolarità | Procedura verificata di identità/rappresentanza, notifica e audit; recupero account distinto da trasferimento gestione |
| Spese/note | Data, quota progetto e riferimento; correzioni tracciate, accesso amministrativo esclusivo |
| Cancellazione dati | Percorso dedicato con verifica di diritto, perimetro, policy e rinnovi; esecuzione controllata e risultato verificabile |

La concessione gratuita resta aziendale, non diventa un privilegio globale dell'account del titolare. Se assegnata a un cliente già pagante, separare decorrenza, stop rinnovi provider ed eventuale rimborso: un flag nel DB non ferma gli addebiti.

Gli eventuali codici gratuiti sono opzionali: destinatario, hash, scadenza del riscatto e monouso atomico. La scadenza del codice non fa scadere il beneficio già assegnato.

Ogni mutazione presenta prima il risultato concreto, richiede un motivo e produce audit con identificativo operazione. Validazione e idempotenza sono server; gestire doppio submit, conflitti concorrenti e retry senza duplicare effetti.

Non offrire un pulsante generico «cancella tutto». Pausa, uscita commerciale, cancellazione account e cancellazione dei dati sono processi diversi. Revoca accessi, assistenza e richieste valide sui diritti restano disponibili in archivio.

## Scadenze e anomalie da mostrare

- Prova di 30 giorni vicina alla fine, proroghe e condizioni di acquisto mancanti.
- Rinnovo fallito, motivo disponibile, tentativi provider e termine della grazia di 7 giorni per clienti già paganti.
- Fine operatività e finestra separata di 7 giorni per completare presenze pregresse, senza nuovi turni o spostamento dell'archivio.
- Pausa/disdetta richiesta ma non confermata nel provider, comprese le sedi extra ancora fatturate.
- Downgrade pendente, organico incompatibile, avvisi a 28/30 persone e sedi oltre capacità.
- Rinnovi annuali vicini, importo e promemoria a 30/7 giorni; variazioni prezzo con preavviso approvato di 60 giorni.
- Uso documenti all'80/90% della quota e limite raggiunto: blocco solo nuovi upload, mai cancellazione automatica per quota.
- Quota iniziale di 2 GiB per azienda da calibrare sui tester, 10 MiB per file, override motivati e costi dei clienti gratuiti.
- Archivio vicino ai 12 mesi, avvisi da inviare, riattivazioni concorrenti e cancellazioni fallite/da verificare.
- Pagamenti duplicati, rimborsi/contestazioni aperti, payout mancanti e importi non riconciliati.
- Webhook falliti/fuori ordine, autorizzazioni revocate e richieste di recupero della gestione.
- Backup DB e file mancanti, ripristino non verificato, incidenti aperti e comunicazioni di servizio necessarie.

Ogni segnalazione mostra azienda, data, fonte, gravità, azione proposta e stato di risoluzione. La dashboard distingue una richiesta da un risultato effettivo; non nasconde gli errori dietro uno stato «completato» locale.

## Assistenza e continuità

Registrare richieste, prima risposta, esito e tempo dedicato, usando soltanto dati necessari. Il supporto approvato comprende email/modulo italiano, gestione lun–ven festivi esclusi, obiettivo di prima risposta entro **2 giorni lavorativi** e una call iniziale di **30 minuti** su richiesta. Gli incidenti bloccanti hanno priorità; prima risposta e risoluzione restano metriche distinte.

La dashboard deve permettere di verificare backup/ripristino di database **e file Storage**, alert critici e comunicazione dei disservizi. Registrare data ed esito delle prove, senza dichiarare un tempo di ripristino garantito non misurato.

L'assistenza non introduce lettura generale dei dati HR o impersonazione nella prima versione. Un intervento sui dati individuali richiede un perimetro minimo, uno scopo documentato e un percorso registrato. Le prove sensibili di recupero si trasmettono con canali adeguati e conservazione limitata, non nel campo libero delle note commerciali.

## Registro e confini di lettura/scrittura

Il registro conserva attore, timestamp server, azione, oggetto, motivo, esito e variazioni selettive. Non conserva password, token, carte, payload fiscali integrali o copie di documenti HR. Gli eventi provider e i job devono essere collegabili senza duplicare dati personali inutili.

Un cliente vede solo dati e stato commerciale consentiti per la propria azienda; un professionista non riceve prezzi o dati fiscali del titolare. Il fondatore legge riepiloghi amministrativi globali tramite endpoint dedicati, senza alterare la RLS ordinaria dei clienti.

Le scritture amministrative non aggirano limiti, diritto di accesso, stato provider o cancellazioni. I controlli commerciali usano lock e regole del dominio; un override è un'operazione prevista e registrata, non un accesso SQL libero.

## Criteri di accettazione e passi

- [x] M05 nel banco locale: accesso protetto, riepiloghi, ricerca paginata, schede e conteggi spiegabili; cliente/collaboratore/professionista/anon non accedono alle API globali.
- [x] Test SQL: sessione senza MFA, amministratore revocato e account fuori allowlist rifiutati dal backend, anche conoscendo la rotta.
- [ ] Enrollment/challenge TOTP reale, provisioning del fondatore e smoke visuale multiutente su Supabase dev, poi rollout deliberato.
- [ ] M06: gratuità a vita per azienda, piano/sedi/quota, proroghe e audit; eventuale doppio invio non duplica l'azione.
- [ ] Riattivazione con gratuità permanente valida senza carta o pagamento; una concessione non viene trasformata in abbonamento pagante dal flusso di ripresa.
- [ ] Pagamenti, rimborsi e payout sono collegati a esiti verificati; annuale, gratuità e commissioni producono i totali attesi senza doppio conteggio.
- [ ] Spese distinguono cassa/competenza e quota progetto; dati economici privati non sono leggibili dai clienti.
- [ ] M11: pause, grazia, archivio, scadenze e cancellazioni risultano coerenti con server/provider; login ed export non allungano l'archivio.
- [ ] Recupero/trasferimento della gestione preservano storico e contratto, revocano i vecchi accessi pertinenti e lasciano audit.
- [ ] Uso storage proviene da misure affidabili; superare quota non interrompe turni, consultazione o export.
- [ ] Backup/ripristino DB e file, anomalie dei rinnovi e richieste di assistenza sono verificabili prima delle vendite.
- [ ] Il lancio pagante comprende anche M09: checkout web, eventi firmati/idempotenti e riconciliazione. La sola dashboard non abilita il lancio.
- [ ] M10, dopo la base essenziale: snapshot, coorti, conversione, pause/uscite distinte, previsione e automazioni giustificate dal lavoro reale.

Le verifiche automatiche locali M05 sono registrate nella procedura; non equivalgono a una prova visuale/Auth reale o a un rollout. Per regole ancora dipendenti da provider o validazione privacy/fiscale, seguire [MONETIZATION.md](MONETIZATION.md) e il [piano operativo](../plans/MONETIZATION-AND-FOUNDER-DASHBOARD.md).
