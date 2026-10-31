# Procedura per una violazione dei dati personali

Documento interno. Vale per i dati delle aziende clienti (KlokShift
responsabile: avviso ai titolari **entro 48 ore**, DPA condizione aggiuntiva A)
e per i dati di cui KlokShift è titolare (account, abbonamento: notifica al
Garante entro 72 ore se c'è un rischio, art. 33).

## 1. Segnali

- Email o avvisi di Supabase (sicurezza, incidenti, accessi anomali), di Expo,
  Resend, GitHub, Google o Apple.
- Errori anomali nei log (`postgres_logs`, log delle Edge Function), picchi di
  richieste, accessi da posizioni insolite nell'area del fondatore.
- Segnalazioni di clienti o persone del team («vedo dati di un'altra azienda»,
  «ho ricevuto un'email non mia»).
- Chiavi o segreti finiti dove non dovevano (repository pubblico, chat, email).

## 2. Primi passi (subito)

1. Annotare data e ora in cui te ne sei accorto: da lì partono le 48 ore.
2. Fermare la perdita: ruotare la chiave esposta, revocare sessioni o accessi,
   spegnere la funzione coinvolta.
3. Non cancellare tracce: salvare log e schermate.

## 3. Cosa raccogliere

- Cosa è successo e quando (inizio, scoperta, fine).
- Quali aziende sono coinvolte.
- Quali categorie di dati, e se ci sono **dati sanitari** (malattie, certificati).
- Quante persone e quante registrazioni, anche approssimative.
- Probabili conseguenze per le persone.
- Misure prese e da prendere.

## 4. Avviso ai titolari delle aziende (entro 48 ore)

Email a tutti i titolari attivi di ogni azienda coinvolta. Se non tutto è noto,
si manda subito quello che si sa e si completa dopo (clausola 9.2).

```
Oggetto: KlokShift — violazione dei dati della tua azienda

Ciao, ti scriviamo perché il [data] alle [ora] ci siamo accorti di [descrizione].

Cosa riguarda: [categorie di dati], circa [N] persone di [azienda].
Possibili conseguenze: [conseguenze].
Cosa abbiamo fatto: [misure]. Cosa ti consigliamo: [consigli].

Come titolare del trattamento valuti tu se avvisare il Garante (entro 72 ore da
quando lo sai) e le persone coinvolte; ti aiutiamo con tutte le informazioni che
abbiamo. Per qualsiasi domanda rispondi a questa email o scrivi a
info@klokshift.com.

Mattia Caprioli — KlokShift
```

## 5. Registro (art. 33, par. 5)

Ogni violazione si annota qui, anche se si conclude che non c'è rischio.

| Scoperta | Descrizione | Aziende | Dati | Persone | Avviso ai titolari | Misure | Esito |
|---|---|---|---|---|---|---|---|
