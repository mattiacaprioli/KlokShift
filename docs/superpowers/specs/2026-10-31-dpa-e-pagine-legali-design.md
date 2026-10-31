# Accordo sul trattamento dei dati (DPA) e pagine legali — design

Data: 2026-10-31. Stato: **bozza da approvare**. Chiude la voce «validazione
privacy/DPA» aperta in [docs/MONETIZATION.md §9](../../MONETIZATION.md) e la
riga «Aggiornare condizioni del servizio, informativa privacy, ruoli rispetto ai
dati del personale e termini di conservazione» in
[plans/MONETIZATION-AND-FOUNDER-DASHBOARD.md](../../../plans/MONETIZATION-AND-FOUNDER-DASHBOARD.md).

## 1. Intento

Il fondatore vuole che KlokShift sia **tranquilla** sul trattamento dei dati con
i clienti. Un'azienda, o il suo consulente, che legge termini, privacy, rimborsi
e accordo sul trattamento deve trovare ruoli chiari, sicurezza seria, nessuna
contraddizione fra i documenti e nessuna promessa falsa.

Il motivo: finora questi testi sono nati un pezzo alla volta, man mano che
uscivano le funzioni. Ora che arrivano i primi clienti paganti vanno ripensati
come un insieme. I testi **devono reggersi da soli**: non è prevista una
revisione legale prima del lancio. Per questo la regola guida è usare testi
ufficiali dove esistono e scrivere solo ciò che è vero e verificato.

## 2. Obiettivi, non obiettivi, anti-obiettivi

**Obiettivi**

- Un DPA ex art. 28 GDPR in cui l'azienda cliente è titolare e KlokShift è
  responsabile per i dati che l'azienda inserisce.
- Privacy, termini e rimborsi riscritti per combaciare con il DPA e con il
  prodotto reale.
- Pagine pubbliche per i sub-responsabili e la sicurezza, più una scheda
  pronta da inserire nell'informativa che l'azienda dà ai dipendenti.
- Un'accettazione **esplicita e registrata** di termini e DPA da parte di chi
  crea l'azienda.
- Le poche modifiche al prodotto che servono perché i testi possano dire il
  vero.

**Non obiettivi**

- Un modello completo di informativa per i dipendenti: nessun concorrente lo
  offre e senza revisione legale esporrebbe il fondatore (scelta del 31/10).
- Certificazioni (ISO 27001, SOC 2), DPO esterno, verifiche di terzi.
- MFA per chi gestisce e backup del database: si dichiarano come stato attuale
  e arrivano dopo (§8).
- Testi in altre lingue. Il sito resta in italiano.

**Anti-obiettivi** (il lavoro fallisce anche se le pagine esistono)

- Una promessa che il sistema non mantiene: backup, cifrature, tempi di
  cancellazione, fornitori non elencati. È esattamente il difetto della
  privacy di oggi («i dati eliminati spariscono dai backup entro 30 giorni»,
  ma i backup non ci sono).
- Due documenti che dicono cose diverse sullo stesso punto (ruoli, durata
  dell'archivio, cosa resta dopo la cancellazione dell'account).
- Un impegno che un fondatore da solo non riesce a mantenere: tempi di
  risposta, verifiche, preavvisi.
- Toccare l'anteprima dei messaggi nelle push. Resta com'è, per scelta del
  fondatore.

## 3. Situazione verificata (31/10, sola lettura)

Questa sezione è la fonte dei fatti per gli allegati. Se un fatto cambia
prima della pubblicazione, va ricontrollato.

| Tema | Fatto | Dove |
|---|---|---|
| Database e file | Supabase, regione `eu-central-1` (Francoforte), Postgres 17 | progetto `rmlobxjlqlpixkvrzmfg` |
| Bucket | `staff-documents` privato (10 MB per file), `avatars` pubblico (5 MB) | `storage.buckets` |
| Accesso ai dati | RLS per persona/azienda, scritture solo da RPC, banco SQL in CI | `supabase/tests/rls/` |
| Area del fondatore | Allowlist, MFA `aal2`, nessuna lettura ordinaria di chat/documenti/note HR, registro degli interventi | `docs/FOUNDER-DASHBOARD.md`, `private.admin_operations` |
| Accesso tecnico | Il fondatore ha le chiavi di Supabase e tecnicamente può leggere tutto | — |
| Inviti | Token monouso, nel DB solo lo SHA-256 | `accept-invite`, `invite-staff` |
| MFA | Solo il fondatore (1 fattore in `auth.mfa_factors`); titolari e collaboratori solo password | — |
| Password violate | Controllo HaveIBeenPwned spento (richiede piano Supabase a pagamento) | advisor `auth_leaked_password_protection` |
| Backup | Nessuno sul piano gratuito; arrivano col piano a pagamento dopo i primi 2-3 clienti | decisione del fondatore, 31/10 |
| Push | Expo Push API (USA) → APNs / FCM. Il testo è quello della notifica in-app | `supabase/functions/push` |
| Push della chat | Nome del mittente + primi 80 caratteri del messaggio. **Resta così** | `20260920001900_chat_peers.sql` |
| Push delle malattie | «Malattia comunicata» / «X è in malattia dal…»: dato sanitario fuori UE e sullo schermo bloccato | `20261031000100_absences_out_of_chat.sql` |
| Email | SMTP Resend (inviti, promemoria dell'archivio, cambi di piano) | `invite-staff`, `archive-reminders`, `billing-scheduled` |
| Sito e dashboard | GitHub Pages (USA) | `.github/workflows/deploy-web.yml` |
| Font del web | Google Fonts caricato dai server di Google su `web-site/index.html`, `web-site/invito.html`, `web/index.html`. L'app nativa li ha nel bundle (`@expo-google-fonts`) | — |
| Sentry | Nell'app solo se c'è `EXPO_PUBLIC_SENTRY_DSN`, con `sendDefaultPii: false`; oggi non attivo. La dashboard non lo usa | `src/app/_layout.tsx`, `web/src/lib/reportError.ts` |
| Pagamenti | Paddle, Merchant of Record e titolare autonomo; Paddle.js caricato solo all'acquisto | `web/src/pages/Piano.tsx` |
| Geolocalizzazione | Non raccolta: nessuna colonna di posizione nel DB | `information_schema.columns` |
| Dati sanitari | Malattie in `staff_absences` (con `inps_protocol` e `note`); certificati possibili fra i documenti | — |
| Accettazione termini | **Nessuna** registrata: i termini sono solo linkati accanto all'acquisto | `src/features/account/legal.ts` |
| Archivio | 12 mesi da `operational_until`; cancellazione avviata a mano dal fondatore (`admin_delete_workspace_data`) | `20261020000000_workspace_data_deletion.sql` |
| Cancellazione account | La scheda nell'azienda resta all'azienda; i messaggi restano con «Utente eliminato» | `delete-account`, privacy §5 |

## 4. Approcci considerati

**A. Clausole tipo UE su una pagina propria — scelto.** Il DPA è costruito sulla
Decisione di esecuzione (UE) 2021/915, clausole contrattuali tipo fra titolare e
responsabile (art. 28, par. 7), nella versione italiana ufficiale. Le clausole
restano quelle; si scelgono le opzioni previste e si riempiono i quattro
allegati con i fatti del §3. *Pro:* è la base più solida senza revisione
legale, riconoscibile da qualunque consulente, ed è difficile che manchi un
requisito. *Contro:* più lungo e più formale dei concorrenti; alcune clausole
sono meno favorevoli al fornitore (per esempio le verifiche presso il
responsabile sono ammesse, non solo quelle su documenti).

**B. DPA scritto da noi, corto, dentro i termini (come Connecteam e Skello).**
*Pro:* più leggibile, limiti più comodi per il fornitore (verifiche solo su
documenti, 7 giorni per opporsi, disdetta come unico rimedio). *Contro:* senza
revisione legale è facile dimenticare un requisito dell'art. 28, e un cliente
strutturato potrebbe non fidarsi. Scartato.

**C. DPA firmato cliente per cliente.** Non scala e non serve ai clienti
piccoli. Resta solo come PDF controfirmato **su richiesta**, sullo stesso testo
di A.

Il fondatore ha scelto A il 31/10.

## 5. Cosa ha deciso il fondatore

- I documenti devono reggersi da soli, senza revisione legale.
- Il DPA segue l'approccio A.
- **Due ruoli.** KlokShift è titolare per account e profilo personale,
  abbonamento e pagamenti, sicurezza e diagnostica, sito. È responsabile per
  i dati che l'azienda inserisce o fa nascere usando il servizio: team e
  schede, sedi, turni, presenze e ore, timbrature e pause, assenze, documenti,
  chat e notifiche collegate.
- **Push.** L'anteprima dei messaggi della chat resta com'è e il DPA lo
  dichiara. Le push delle **malattie** diventano neutre.
- **Font.** Google Fonts si ospita in casa.
- **MFA per chi gestisce e backup** si dichiarano come stato attuale e si
  aggiungono più avanti. I backup arrivano col piano Supabase a pagamento dopo
  i primi 2-3 clienti.
- **Informativa ai dipendenti.** Niente modello completo: una scheda «Cosa fa
  KlokShift con i dati del tuo team» da inserire nella propria informativa.
  Coincide con l'Allegato II.
- **L'archivio di 12 mesi** diventa l'istruzione predefinita dell'azienda nel
  DPA, con la cancellazione anticipata sempre possibile.
- **Accettazione esplicita** di termini e DPA alla creazione dell'azienda,
  registrata. Le aziende esistenti accettano al primo accesso dopo il
  rilascio, **con un blocco**: senza accettare non si va avanti.
- **Violazioni dei dati:** l'azienda viene avvisata senza ingiustificato
  ritardo e **al massimo entro 48 ore** da quando KlokShift se ne accorge.
- **Nuovo sub-responsabile:** preavviso di **15 giorni**. Se l'azienda si
  oppone può fermare i rinnovi e disdire, ma **senza rimborso** del periodo
  già pagato (scelta del 31/10).

## 6. Cosa si costruisce

### 6.1 Pagine pubbliche (`web-site/public/`)

Restano gli indirizzi attuali (`privacy.html`, `termini.html`, `rimborsi.html`,
`elimina-account.html`): sono dichiarati negli store e in `legal.ts`. Si
aggiungono:

| Pagina | Contenuto |
|---|---|
| `dpa.html` | Clausole 2021/915 con le opzioni scelte (§7) e gli Allegati I–IV. Gli Allegati III e IV rimandano alle pagine sotto e ne fissano la versione |
| `sub-responsabili.html` | Elenco con ragione sociale, scopo, dati ricevuti, luogo, garanzia per il trasferimento; data dell'ultima modifica e storico delle modifiche |
| `sicurezza.html` | Le misure tecniche e organizzative (Allegato III) in linguaggio piano, con una sezione «Cosa non c'è ancora» (MFA per chi gestisce, backup) |
| `dati-del-team.html` | La scheda per l'informativa ai dipendenti: quali dati, perché, dove, fornitori, per quanto, come si cancellano, a chi rivolgersi. È l'Allegato II scritto per essere copiato |

Ogni pagina ha **numero di versione e data**. Le versioni sostituite restano
pubblicate con il numero nel nome (per esempio `dpa-v1.html`), così
un'accettazione registrata rimanda sempre al testo esatto.

Le pagine vanno aggiunte alla sitemap e ai link del footer, e `legal.ts` deve
esporre i nuovi indirizzi.

### 6.2 Riscritture

**Privacy (`privacy.html`).** Due parti.

1. *Quando KlokShift è titolare:* account e profilo, abbonamento, sicurezza,
   sito. Basi giuridiche, fornitori, conservazione, diritti come oggi, corretti
   così:
   - aggiungere GitHub Pages e Resend;
   - togliere Google Fonts, sostituito dai font in casa (§6.4);
   - Sentry compare solo quando viene attivato;
   - dire che il testo delle notifiche passa da Expo, Apple e Google;
   - **togliere la promessa sui backup entro 30 giorni**;
   - ricontrollare contro il codice ogni riga di §5 «Conservazione e
     cancellazione», in particolare il compleanno che resta nel profilo
     tecnico.
2. *Quando titolare è la tua azienda:* per i dati del team KlokShift è
   responsabile. L'informativa la dà l'azienda, e le richieste su quei dati
   vanno rivolte all'azienda. Se arrivano a KlokShift, le giriamo all'azienda.
   Link a `dati-del-team.html`.

**Termini (`termini.html`).**

- §12 diventa «Dati personali». Il DPA è parte integrante dei termini per
  l'azienda cliente. Va detto chi è titolare di cosa e come si accetta.
- §3: chi crea l'azienda accetta termini e DPA per conto dell'azienda e
  dichiara di poterla rappresentare (c'è già in parte).
- §8 e DPA: archivio di 12 mesi e cancellazione con le stesse parole.
- §16: la responsabilità vale anche per il DPA, nei limiti di legge.
- §17: le modifiche sostanziali al DPA chiedono una nuova accettazione.
- «Usando il servizio li accetti» resta per chi non crea un'azienda
  (dipendenti, collaboratori), ma non è la base del DPA.

**Rimborsi (`rimborsi.html`).** Allineare §4 alle parole dell'archivio.
L'opposizione a un sub-responsabile non dà diritto a un rimborso: non serve una
voce nuova, vale il §5 «Dopo i 14 giorni».

### 6.3 Accettazione registrata (prodotto)

- Una tabella delle accettazioni con: azienda, persona, documento, versione e
  momento dell'accettazione. Si scrive solo da RPC, come il resto
  (`supabase/tests/rls/050_surface.sql`).
- Alla creazione dell'azienda, nell'app e sul web, c'è una casella non
  preselezionata: «Accetto i termini e l'accordo sul trattamento dei dati per
  conto dell'azienda», con link alle due pagine. Senza la casella l'azienda non
  nasce.
- **Aziende esistenti** (6 oggi, tutte di prova o concesse dal fondatore):
  al primo accesso dopo il rilascio il titolare (`authority = owner`) deve
  accettare. È un **blocco**: finché nessun titolare dell'azienda ha
  accettato, chi la gestisce non entra nella vista di gestione (app e web) e
  vede solo la richiesta. I dipendenti non sono bloccati: il loro lavoro non
  dipende dall'accordo fra l'azienda e KlokShift.
- **Nuova versione sostanziale:** stesso blocco alla scadenza dei 30 giorni
  di preavviso via email previsti dai termini.
- **PDF controfirmato:** su richiesta via email, generato a mano dal
  fondatore. Nessuna funzione nel prodotto.

### 6.4 Modifiche al prodotto perché i testi dicano il vero

1. **Push e notifiche delle malattie neutre.** In
   `private.request_absence` (oggi `20261031000100_absences_out_of_chat.sql`)
   titolo e testo per `p_kind = 'malattia'` diventano generici, per esempio
   «Nuova assenza» / «Mario ha comunicato un'assenza dal…». Lo stesso vale
   per l'annullamento («ha annullato un'assenza») e per ogni altra notifica che
   nomina la malattia: va cercata nelle migration in vigore. Il dettaglio resta
   nella pagina Assenze. Ferie e permessi restano come sono. La notifica in-app
   e la push hanno lo stesso testo, quindi si cambia in un punto solo. Serve una
   migration nuova (le migration applicate sono immutabili). I testi vanno
   riletti col glossario (`docs/GLOSSARIO.md`), e il ripiego «Un professionista»
   diventa «Un dipendente».
2. **Font in casa.** Fraunces, Inter e IBM Plex Mono serviti dal sito e dalla
   dashboard, senza `fonts.googleapis.com` né `fonts.gstatic.com`, su
   `web-site/index.html`, `web-site/invito.html` e `web/index.html`. Pesi e
   stili restano quelli in uso oggi.
3. **Accettazione registrata** (§6.3).

### 6.5 Documenti interni (non pubblicati, in `docs/privacy/`)

- **Registro dei trattamenti come responsabile** (art. 30, par. 2). L'esenzione
  sotto i 250 dipendenti non vale con dati sanitari trattati in modo non
  occasionale.
- **Procedura per una violazione dei dati.** Come se ne accorge il fondatore,
  cosa raccoglie, come avvisa le aziende entro le 48 ore e con quale testo,
  dove la registra (art. 33, par. 5).
- **Elenco delle azioni del fondatore verso i fornitori**: accettare o firmare
  i DPA di Supabase, Expo, Resend, GitHub e Google/Firebase, e verificare la
  garanzia di trasferimento di ciascuno (§9).

## 7. Opzioni scelte nelle clausole 2021/915

| Clausola | Scelta |
|---|---|
| 5 — Clausola di adesione | Inclusa (utile se in futuro si aggiunge un'altra entità) |
| 7.7 — Sub-responsabili | **Opzione 2, autorizzazione generale** con elenco in `sub-responsabili.html` e preavviso scritto (email ai titolari) di **15 giorni**. All'opposizione
segue la sola possibilità di disdire, senza rimborso |
| 7.6 — Verifiche | Testo della clausola invariato. Nell'allegato si dice come si fanno in pratica: prima la documentazione (questa pagina, `sicurezza.html`, registro), poi un'ispezione con preavviso ragionevole se la documentazione non basta |
| 9.2 — Violazioni | «Senza ingiustificato ritardo» come da clausola, più un termine massimo esplicito di **48 ore** da quando KlokShift se ne
accorge |
| 10 — Fine del contratto | Cancellazione o restituzione secondo la scelta del titolare. **Predefinito:** archivio di 12 mesi da `operational_until`, poi cancellazione entro 30 giorni (scelta di Claude, §11). Su richiesta, cancellazione anticipata |

**Allegato I — Parti.** Il cliente come titolare, con i dati dell'azienda e chi
ha accettato. KlokShift (ditta individuale Mattia Caprioli, P. IVA, sede,
contatto) come responsabile.

**Allegato II — Descrizione.**

- **Interessati:** dipendenti, collaboratori, titolari.
- **Categorie di dati:** quelle del §3.
- **Dati particolari:** malattia (date, eventuale protocollo INPS) ed
  eventuali certificati caricati come documenti.
- **Durata:** il contratto più l'archivio.
- **Finalità:** erogare il servizio.

L'anteprima della chat nelle push compare qui e nell'Allegato IV.

**Allegato III — Misure.** Solo quelle verificate al §3 e garantite dal
fornitore di hosting, ciascuna marcata come «nostra» o «del fornitore». C'è una
voce esplicita «non ancora presenti»: backup, MFA per chi gestisce, controllo
delle password violate. Va detto anche chi accede: solo il fondatore, solo per
assistenza richiesta, incidenti o obblighi di legge, con registro per gli
interventi dall'area del fondatore.

**Allegato IV — Sub-responsabili.** Il contenuto di `sub-responsabili.html`
alla data della versione.

## 8. Cosa resta dichiarato e non risolto

- **Backup.** Assenti fino al passaggio al piano Supabase a pagamento. Il
  DPA e `sicurezza.html` lo dicono, insieme a cosa vuol dire: un guasto grave
  del fornitore può far perdere dati. Quando arrivano i backup cambiano
  `sicurezza.html` e la privacy (tempi di rotazione reali), con una nuova
  versione.
- **MFA per chi gestisce** e **controllo delle password violate.** Dichiarati
  come assenti, da aggiungere.
- **Accesso tecnico del fondatore.** Non si elimina: si dichiara e si limita
  nelle istruzioni.

## 9. Lasciato a chi costruisce

- Prendere il testo italiano ufficiale della Decisione 2021/915 da EUR-Lex e
  riportarlo fedelmente. Le opzioni scartate si tolgono, le parti fra
  parentesi si riempiono.
- Per ogni sub-responsabile: ragione sociale esatta, luogo del trattamento,
  esistenza del DPA del fornitore e garanzia di trasferimento (certificazione
  EU-US Data Privacy Framework o clausole tipo). **Non scrivere una garanzia
  non verificata sulla fonte del fornitore.** Se una non si trova, va
  segnalata al fondatore prima di pubblicare.
- Le misure del fornitore (cifratura a riposo, TLS, isolamento) si citano dalla
  documentazione di Supabase con la data della consultazione.
- Nome e forma esatta della tabella delle accettazioni, l'RPC, dove si inserisce
  la casella nei due flussi di creazione dell'azienda e la richiesta per le
  aziende esistenti.
- Il testo neutro esatto delle notifiche delle malattie.
- Come servire i font: file nel repo o pacchetto. Restano solo i pesi in uso.
- Stile delle nuove pagine: lo stesso delle pagine legali di oggi.

## 10. Decisioni aperte

Nessuna. Le tre rimaste (violazioni in 48 ore, sub-responsabili con 15 giorni e
senza rimborso, blocco per le aziende esistenti) sono state chiuse dal
fondatore il 31/10 e stanno al §5.

## 11. Scelte di Claude, da controllare

- KlokShift è **responsabile** anche per la chat fra membri dell'azienda: fa
  parte del servizio che l'azienda dà al suo team. Resta **titolare** per
  account e profilo personale, perché l'account vale fra più aziende.
- Nei documenti l'azienda cliente si chiama «il Cliente», per non confonderla
  con il «titolare» del prodotto (`authority = owner`). Il ruolo GDPR si dice
  sempre per intero: «titolare del trattamento».
- **Nessun DPO designato.** KlokShift non tratta oggi dati sanitari su larga
  scala come attività principale. Va rivisto con la crescita.
- Cancellazione **entro 30 giorni** dalla fine dell'archivio, perché oggi la
  avvia a mano il fondatore.
- Sentry non va nell'elenco finché non è attivo. Attivarlo è un nuovo
  sub-responsabile con preavviso.
- La responsabilità segue il limite dei termini (§16), salvo ciò che la legge
  non permette di limitare.
- Le versioni vecchie restano pubblicate con il numero nel nome.
- La scheda per i dipendenti è una pagina pubblica e non un PDF: si aggiorna
  con il resto e si copia facilmente.
- Con più titolari nella stessa azienda **basta l'accettazione di uno**. Gli
  avvisi del DPA (sub-responsabili, violazioni, nuove versioni) vanno via email a
  tutti i titolari attivi.
- Le **garanzie sui dati sanitari** dell'Allegato II sono quelle già nel
  prodotto, da verificare nel codice prima di scriverle:
  - malattia visibile solo a chi gestisce il team;
  - i colleghi vedono l'assenza senza il tipo;
  - push neutre (§6.4).
