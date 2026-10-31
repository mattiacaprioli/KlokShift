# Registro dei trattamenti — KlokShift come responsabile (art. 30, par. 2 GDPR)

Documento interno, da esibire su richiesta del Garante o di un cliente. Non si
pubblica. Ultimo aggiornamento: 31 ottobre 2026.

L'esenzione per chi ha meno di 250 dipendenti (art. 30, par. 5) non si applica:
il servizio tratta in modo non occasionale dati relativi alla salute (malattie).

## a) Responsabile del trattamento

- Mattia Caprioli, ditta individuale, che fornisce il servizio KlokShift.
  P. IVA 01256680578. Sant'Antonio snc, fraz. Calcariola, 02015 Cittaducale (RI).
  info@klokshift.com.
- Responsabile della protezione dei dati: non designato (da rivedere se il
  trattamento di dati sanitari diventa su larga scala).

## Titolari per conto dei quali si tratta

Le aziende clienti. L'elenco non si copia qui: è la tabella
`private.legal_acceptances` (azienda, chi ha accettato, versione, data), unita
a `public.workspaces` per nome e stato. Query:

```sql
select w.name, w.id, a.version, a.accepted_at, a.user_id
  from private.legal_acceptances a join public.workspaces w on w.id = a.workspace_id
 order by a.accepted_at desc;
```

## b) Categorie di trattamenti

Per ogni azienda cliente, come da `web-site/public/dati-del-team.html` v1 e
Allegato II del DPA:

| Trattamento | Interessati | Dati |
|---|---|---|
| Organizzazione di turni e sedi | dipendenti, collaboratori, titolari | nome, ruoli, sedi, turni, conferme, cambi turno |
| Presenze, timbrature e ore | chi lavora nei turni | orari di entrata/uscita/pausa, metodo, correzioni con autore, approvazioni, ore |
| Assenze | chi lavora nei turni | ferie, permessi, malattia (date; per la malattia eventuale protocollo del certificato) — **dati sanitari** |
| Documenti | persone della scheda | contratti, attestati, certificati, scadenze |
| Comunicazioni | membri dell'azienda | messaggi della chat, notifiche, identificativi dei dispositivi |
| Schede del team | persone dell'azienda | nome nell'azienda, email, telefono, lingue, tipo di rapporto, ore da contratto, note |
| Export | — | ore e presenze per il consulente del lavoro, export completo dell'azienda |
| Conservazione a fine servizio | tutti i precedenti | archivio 12 mesi da `operational_until`, poi cancellazione entro 30 giorni (`admin_delete_workspace_data`, coda file `workspace-file-cleanup`) |

## c) Trasferimenti verso paesi terzi

Come da `docs/privacy/fornitori.md` e `web-site/public/sub-responsabili.html`
v1: Expo, Apple, Google, Resend e GitHub (Stati Uniti), con EU-U.S. Data Privacy
Framework o clausole contrattuali tipo dove verificato; Supabase con i dati in
UE e clausole tipo 2021/914 per gli accessi dall'estero.

## d) Misure di sicurezza

Come da `web-site/public/sicurezza.html` v1, compresa la sezione «Cosa non c'è
ancora» (backup, MFA per chi gestisce, blocco delle password violate).

## Revisione

Va riletto a ogni nuova versione del DPA, di `sub-responsabili.html` o di
`sicurezza.html`, e almeno una volta l'anno.
