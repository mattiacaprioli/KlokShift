# Fornitori che trattano dati — verifica e azioni

Fonte interna di `web-site/public/sub-responsabili.html` (versione 1). Ogni riga
dice cosa è stato verificato, dove e quando. **Una garanzia non trovata non si
scrive nella pagina pubblica**: resta qui come «da verificare».

Consultazione: 31 ottobre 2026.

| Fornitore | Ruolo per KlokShift | Dati che riceve | Luogo | DPA del fornitore | Garanzia per il trasferimento | Fonte |
|---|---|---|---|---|---|---|
| Supabase, Inc. | sub-responsabile | tutto il database, i file, l'autenticazione, il realtime | UE, `eu-central-1` (Francoforte); il DPA ammette eccezioni (assistenza, sicurezza) | Sì: fa parte dei Termini di Supabase (versione 1 del 1° agosto 2026); copia firmata via PandaDoc dalla pagina «Legal documents» della dashboard | Clausole contrattuali tipo 2021/914 nel DPA. DPF non citato nel DPA | [DPA](https://supabase.com/legal/customer-resources/data-processing-addendum) |
| 650 Industries, Inc. (Expo) | sub-responsabile | token del dispositivo, titolo e testo delle notifiche (anche l'anteprima dei messaggi della chat) | USA | **Non trovato** un DPA pubblico né una procedura per richiederlo | L'informativa di Expo dichiara l'adesione all'EU-U.S. Data Privacy Framework e il ricorso a clausole tipo «dove richiesto». **Iscrizione all'elenco ufficiale DPF da verificare** su dataprivacyframework.gov | [Privacy Expo](https://expo.dev/privacy) (agg. 21/10/2025), [sub-responsabili Expo](https://expo.dev/privacy/subprocessors) |
| Google LLC (Firebase Cloud Messaging) | sub-responsabile | identificativo dell'installazione, titolo e testo delle notifiche su Android | USA e altri paesi | Sì: Firebase Data Processing and Security Terms, da accettare nella console Firebase del progetto | Certificazione EU-U.S. DPF dichiarata da Google; clausole tipo nei termini Firebase | [Privacy Firebase](https://firebase.google.com/support/privacy) |
| Apple (Apple Inc. / Apple Distribution International Ltd) | sub-responsabile per la consegna su iOS | token del dispositivo, titolo e testo delle notifiche su iOS | USA e altri paesi | **Non trovato** un DPA specifico per APNs: il servizio è regolato dal contratto Apple Developer Program. **Da verificare** | L'informativa Apple dichiara clausole contrattuali tipo per i dati dallo SEE; nessuna adesione al DPF dichiarata | [Privacy Apple](https://www.apple.com/legal/privacy/en-ww/) (agg. 30/07/2025) |
| Resend, Inc. | sub-responsabile | indirizzo email e testo delle email (inviti, promemoria dell'archivio, avvisi sul piano) | USA | Sì: [resend.com/legal/dpa](https://resend.com/legal/dpa) | Certificazione EU-U.S. DPF (marzo 2025) e clausole tipo nel DPA | [GDPR Resend](https://resend.com/security/gdpr), [changelog DPF](https://resend.com/changelog/data-privacy-framework-certification) |
| GitHub, Inc. (GitHub Pages) | sub-responsabile per la dashboard; fornitore del sito | indirizzo IP e dati tecnici delle richieste a sito e dashboard. I dati delle aziende **non** passano da GitHub: la dashboard parla direttamente con Supabase | USA | GitHub Data Protection Agreement, parte del GitHub Customer Agreement. **Da verificare** se copre un account non Enterprise e GitHub Pages | Certificazione EU-U.S. DPF dichiarata da GitHub | [Privacy GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) |
| Paddle.com Market Ltd | **titolare autonomo** (Merchant of Record), non sub-responsabile | dati di pagamento e fatturazione di chi acquista | Regno Unito e altri paesi | — | Secondo l'informativa di Paddle | già in `privacy.html` |

Non elencati, con motivo:

- **Sentry**: l'SDK è nell'app ma senza `EXPO_PUBLIC_SENTRY_DSN` non invia nulla; la dashboard non lo usa. Attivarlo significa **aggiungere un sub-responsabile** con 15 giorni di preavviso ai titolari.
- **Google Fonts**: tolto dal 31/10 (font serviti da noi, test `noExternalFonts`).
- **Expo EAS Build**: costruisce l'app, non riceve dati delle aziende.

## Azioni del fondatore (prima di pubblicare)

> ⚠️ **Bloccante per la pubblicazione del DPA.** La clausola 7.7, lettera b)
> impegna KlokShift ad avere con ogni sub-responsabile un contratto con, nella
> sostanza, gli stessi obblighi. Oggi è documentato per Supabase, Google e
> Resend; per **Expo** e **Apple** un DPA non è stato trovato, per **GitHub** la
> copertura è da verificare. Finché queste tre righe non hanno almeno una
> conferma scritta del fornitore (o il fondatore non decide di pubblicare
> spiegandolo nella pagina), il DPA non va presentato come pronto.

- [ ] Supabase: dashboard → organizzazione → **Legal documents** → richiedere e firmare il DPA (PandaDoc). Conservare il PDF.
- [ ] Expo: scrivere al supporto per un DPA o una conferma scritta del ruolo e delle garanzie; controllare «650 Industries» sull'elenco ufficiale [dataprivacyframework.gov](https://www.dataprivacyframework.gov/list). Finché manca, la pagina pubblica dice solo ciò che Expo dichiara.
- [ ] Firebase: console del progetto → Impostazioni progetto → Privacy → accettare i **Data Processing and Security Terms**.
- [ ] Apple: verificare nel contratto Apple Developer Program la clausola sul trattamento dei dati di APNs.
- [ ] Resend: accettare il DPA dalla dashboard di Resend, se richiede un'azione, e controllare la regione d'invio.
- [ ] GitHub: verificare se il Data Protection Agreement copre l'account (non Enterprise) e Pages; se no, valutare un hosting UE per la dashboard.
- [ ] Ricontrollare la DPF di Google e GitHub sull'elenco ufficiale.

Ogni azione completata si segna qui con la data. Un cambiamento (fornitore
nuovo, regione, garanzia) cambia `sub-responsabili.html` con una nuova versione
e, se il fornitore è nuovo, l'email ai titolari 15 giorni prima.

## Lacuna nota: clausola 7.7, lettera e) del DPA

Le clausole tipo 2021/915 chiedono che il contratto con ogni sub-responsabile
contenga una clausola del terzo beneficiario: se KlokShift cessasse di
esistere, l'azienda cliente potrebbe imporre direttamente al fornitore di
cancellare o restituire i dati. I contratti standard di Supabase, Expo, Apple,
Google, Resend e GitHub non si negoziano e non la contengono in questa forma.
La clausola resta nel DPA perché il testo non si modifica (clausola 2); va
tenuto presente se un cliente lo chiede, e va rivisto se si passa a contratti
negoziati (per esempio un piano Supabase Enterprise).
