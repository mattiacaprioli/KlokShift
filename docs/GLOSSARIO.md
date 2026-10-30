# Glossario — le parole che legge l'utente

Deciso il 2026-10-30. Obiettivo: un ragazzo di vent'anni capisce l'app al primo
colpo. **Una parola per concetto**, sempre la stessa, in app, dashboard, sito,
notifiche (SQL), email ed errori.

I nomi interni (`waiter`, `manager`, `staff`, `team/`, `venue_members`, rotte,
chiavi di query, id dei tab) **non cambiano**: cambia solo il testo.

| Concetto | Si scrive | Non si scrive |
|---|---|---|
| Le persone che lavorano in un'azienda/sede | **team** — «il tuo team», «aggiungi al team», «mettiti nel team», tab e menu «Team» | organico, staff, personale |
| Chi lavora nei turni | **dipendente** — «Sono un dipendente» | professionista, cameriere |
| Tipo di rapporto | **fisso** / **a chiamata** — «chi è a chiamata» | collaboratore a chiamata, extra |
| Chi aiuta il titolare a gestire | **collaboratore** (solo in questo senso) | delegato, gestore |
| Chi ha aperto l'azienda | **titolare** | proprietario, datore di lavoro |
| Il luogo | **sede** | locale, ristorante, ristoratore |
| L'insieme delle sedi | **azienda** (solo quando conta che le sedi sono più d'una) | workspace |
| Chi decide, visto dal dipendente | **la sede** («la sede verifica»); **il titolare** se è proprio lui | datore di lavoro |
| Cosa fa una persona in turno | **ruolo** (Reception, Cassa, Magazzino, Sala…) | mansione |
| Quante persone servono in un turno | **persone che servono** / **posti** | fabbisogno |
| Il permesso del collaboratore sulle persone | **Team** | Organico |
| Il calendario dei turni (app e dashboard) | **Turni** | Planning |

## Parole da ufficio → frasi normali

| Invece di | Scrivi |
|---|---|
| operatività terminata | l'azienda non è più attiva |
| fine operatività | attiva fino al |
| capacità (del piano) | limite / numero massimo del piano |
| rettifiche / presenze pregresse | correzioni alle presenze passate |
| consuntivo | riepilogo ore |
| anagrafica | dati personali / scheda |
| finestra di timbratura terminata | è tardi per timbrare dall'app |
| rettificate | corrette |

⚠️ **«Team» è anche il nome di un piano.** Il piano si scrive sempre
«piano Team», mai «Team» da solo né «prova Team».

## Come si controlla

`tests/unit/glossary.test.ts` legge le stringhe di `src/`, `web/src`, `shared/`
e `web-site/src` (non i commenti) e fallisce se trova una parola vietata. Le
eccezioni motivate (per esempio i messaggi dell'area del fondatore) stanno
nell'allowlist del test, con il motivo accanto. Le notifiche scritte in SQL non
sono coperte dal test: chi tocca un trigger rilegge questa pagina.
