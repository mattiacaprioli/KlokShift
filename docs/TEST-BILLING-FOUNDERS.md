# Prova dello sconto «Clienti fondatori» (Paddle sandbox)

## B0 — 22 novembre 2026, a mano

Sconto sandbox `dsc_01m820gne44grwwhcyekfe10ws`: percentuale 30, ricorrente
senza numero di periodi (`maximum_recurring_intervals: null`), `usage_limit`
10, senza codice, limitato agli 8 prezzi (Piccola, Media, Grande e sede
aggiuntiva, mensili e annuali).

⚠️ **Il limite d'uso va tolto** (`usage_limit: null`), anche in sandbox. I posti
li conta solo il database, e nessuno ha verificato se i rinnovi con lo sconto
fanno salire `times_used`: con il limite a 10, dopo 10 acquisti di prova lo
sconto smetterebbe di funzionare qualunque cosa dica il database. Da sistemare
nella dashboard Paddle sandbox prima della procedura B5.

Abbonamento di prova `sub_01m81yrvvt03z0fhb7n5r8krkr` (Grande mensile),
con chiamate dirette all'API sandbox.

| Verifica | Esito |
|---|---|
| `PATCH /subscriptions/{id}` con `discount: {id, effective_from: "next_billing_period"}` | Accettato; `starts_at` = fine del periodo in corso |
| Prossimo rinnovo con lo sconto | 89 € → sconto 26,70 € → 62,30 € + IVA = 76,01 € |
| Lo sconto vale anche sulla sede aggiuntiva (anteprima con una sede) | Sì: ricorrente 104 € → sconto 31,20 € |
| Conguaglio immediato di un aumento | **Non verificato**: lo sconto partiva dal rinnovo, quindi il conguaglio era pieno (14,99 €). Da provare nel B5 con uno sconto applicato al checkout |
| `PATCH /subscriptions/{id}` con `discount: null` | Accettato; il rinnovo torna a 89 € + IVA = 108,58 €, nessun addebito |
| `times_used` dopo l'applicazione con PATCH | Resta 0: lo sconto messo a mano su un abbonamento **non consuma** `usage_limit`. Il conteggio dei posti è quello del database, non quello di Paddle |
| Cambio di ciclo in due PATCH con lo sconto | Non provato: B5 |
| Errore Paddle a `usage_limit` esaurito | Non provato: il codice ripete la creazione senza sconto su qualsiasi errore che nomina lo sconto (B2) |

Esito: la verifica decisiva (togliere lo sconto senza addebiti) passa, il
disegno di B1–B3 resta valido.

## B5 — procedura completa (da fare a mano, sandbox)

Prima: migration `20261122000400` applicata, Edge Function `billing-checkout`
e `billing-scheduled` pubblicate a mano, dashboard con il codice nuovo.
Azienda di prova nuova, titolare di prova, nessun abbonamento precedente.

1. **Acquisto con sconto.** Dalla pagina Piano (sandbox) il totale mostra lo
   sconto accanto al listino e la frase «Sconto fondatori: −30% per 24 mesi».
   Paga con la carta di prova. Attesi: la transazione porta `dsc_…`;
   `workspace_founder_offers` ha una riga `sandbox / active / auto` con
   `ends_at` = primo addebito + 24 mesi (ora di Roma); la pagina Piano dice
   «Sconto fondatori fino al…».
2. **Aumento immediato (conguaglio).** Passa a una fascia più alta o aggiungi
   una sede. Verifica che il conguaglio sia scontato del 30% (nel B0 non era
   verificabile) e che lo sconto resti sull'abbonamento.
3. **Cambio di ciclo al rinnovo.** Programma mensile↔annuale, esegui il
   runner (`billing-scheduled`) nelle 24 ore prima del rinnovo. Atteso: lo
   sconto resta e `ends_at` non si sposta.
4. **Pausa e «Riparti ora».** Metti in pausa a fine periodo, poi «Riparti
   ora». Atteso: lo sconto c'è ancora e l'importo mostrato è scontato.
   **Non ancora verificato.**
   **Pausa a cavallo di `ends_at`.** Metti in pausa, porta `ends_at` a ieri
   (SQL del punto 5) e lancia `billing-scheduled`: il PATCH `discount: null`
   arriva su un abbonamento in pausa e deve essere accettato. Poi «Riparti
   ora»: atteso un periodo a prezzo pieno, mai un periodo scontato dopo
   `ends_at`.
5. **Fine dello sconto.** Dall'editor SQL di Supabase (gira come service
   role: la tabella è chiusa ai client) sposta la scadenza a ieri:
   `update workspace_founder_offers set activated_at = now() - interval '25 months', ends_at = now() - interval '1 day' where workspace_id = '<id>' and environment = 'sandbox';`
   Lancia `billing-scheduled`: deve mandare
   `PATCH /subscriptions/{id}` con `discount: null`. Attesi: l'evento firmato
   porta la riga a `ended`, il posto resta contato, il rinnovo successivo è a
   prezzo pieno (anteprima Paddle senza sconto).
6. **Avviso.** Con `ends_at` entro 60 giorni la notifica
   `founder_offer_ending` arriva una sola volta al titolare (lavoro
   `founder-offer-notices`).
7. **`times_used` dopo un rinnovo** (solo per sapere). Dopo un rinnovo con lo
   sconto, leggi `times_used` dello sconto sandbox
   (`GET /discounts/{id}`) e annota se è salito. Non cambia niente: lo sconto
   resta senza limite d'uso.
8. **Annotare l'esito** per ogni punto in questo file, con data.

**Liberare i posti sandbox.** Con 10 prove i posti sandbox finiscono e il
checkout sandbox non ha più lo sconto. Solo in sandbox, dall'editor SQL di
Supabase (service role):
`delete from workspace_founder_offers where environment = 'sandbox';`
Mai sulle righe `live`.

## Prima del live

1. Ricreare lo sconto nell'account Paddle **live**: 30%, ricorrente senza
   limite di periodi, **senza limite d'uso** (`usage_limit: null`: i posti li
   conta solo il database), nessun codice, solo gli 8 prezzi live.
2. Inserire il suo `dsc_` in `private.billing_discounts`
   (`environment = 'live'`, `kind = 'founder'`) con una migration, come per i
   prezzi live. Senza quella riga il checkout live non ha sconto e il
   fondatore non può riservare posti (`founder_offer_unavailable`).
3. **Prima di passare le Edge Functions al live**, cancellare tutte le righe
   sandbox dall'editor SQL di Supabase:
   `delete from workspace_founder_offers where environment = 'sandbox';`
   Altrimenti le righe sandbox scadute fanno partire il giro ogni 10 minuti
   per sempre e i titolari di prova ricevono l'avviso «Lo sconto fondatori
   finisce…».
