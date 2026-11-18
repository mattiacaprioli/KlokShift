# Chat: spunte inviato, ricevuto, visualizzato — design

2026-11-18. Decisioni prese con il fondatore in conversazione.

## Perché

Due ragioni, entrambe del fondatore:

1. **Sapere se l'altra persona ha letto** — tipicamente il titolare che scrive
   a un dipendente un messaggio che conta («domani apri tu»).
2. **Familiarità**: la chat deve sembrare WhatsApp, che tutti usano già.

## Obiettivi

- Sotto ogni **proprio** messaggio, accanto all'orario, uno stato:
  - 🕓 **in invio** — il messaggio è partito ma il server non l'ha ancora salvato;
  - ✓ grigia **inviato** — salvato sul server;
  - ✓✓ grigie **ricevuto** — l'app (o la dashboard) del destinatario l'ha scaricato;
  - ✓✓ colorate **visualizzato** — il destinatario ha aperto la conversazione.
- Le spunte cambiano **in diretta**, senza ricaricare.
- Uguale in **app** (`ChatThread`) e **dashboard** (`web/src/pages/Chat.tsx`).
- Nella **lista chat**, se l'ultimo messaggio è mio, le stesse spunte accanto
  all'anteprima (al posto o accanto a «Tu:»).

## Non obiettivi

- **Nessun interruttore** per spegnere le conferme: sempre accese, per tutti,
  nei due sensi (anche il dipendente vede se il titolare ha letto). Scelta del
  fondatore, modello Connecteam.
- Nessuna spunta sulle **card** (cambio turno): hanno già il loro stato.
- Nessun «sta scrivendo…», nessun «ultimo accesso», nessuna info per messaggio
  («letto alle 14:32»). Eventuali passi successivi, non ora.
- Nessuna conferma legata alla **push**: non sappiamo in modo affidabile se è
  arrivata, quindi non conta come «ricevuto».

## Anti-obiettivi

- Spunte che **mentono**: mai ✓✓ colorate se l'altro non ha aperto il thread,
  mai «ricevuto» dedotto da qualcosa che non sia il suo client che ha scaricato.
- **Costo su Supabase** sproporzionato (piano free, disco già esaurito una volta,
  vedi memoria `supabase-disk-io-perf`): niente scritture per messaggio in più.
- Rompere il conteggio dei non letti o le notifiche della chat, che oggi
  funzionano.

## Vincoli

- `messages.read_at` esiste già ed è scritto per messaggio da
  `mark_conversation_read` (DEFINER) quando il destinatario apre il thread; regge
  il conteggio dei non letti e il badge. **Resta com'è.**
- Le conversazioni sono sempre a **due** (`user_a < user_b`): niente gruppi, lo
  stato è binario per messaggio.
- Scritture solo da RPC (vedi `supabase/tests/rls/050_surface.sql`): nessun
  UPDATE diretto concesso al client.
- `conversations` **non** è nella publication `supabase_realtime` (ci sono
  `messages` e `notifications`, migration `20260920001300`).
- L'invio oggi **non è ottimistico**: la bolla compare solo dopo il salvataggio
  (`useSendMessage` → `appendMessageToCache` in `onSuccess`).

## Approcci considerati

- **A. `delivered_at` per messaggio**, come `read_at`. Semplice e preciso, ma
  una scrittura in più per ogni messaggio. Scartato dal fondatore per il costo.
- **B. Segnalibro per conversazione per entrambi** (ricevuto e letto). Il più
  economico, ma obbliga a rifare `read_at`, conteggio non letti e notifiche
  della chat sul segnalibro: rischio alto per un risparmio piccolo, perché la
  scrittura di `read_at` esiste già oggi.
- **C. Solo due spunte** (inviato/letto). Il più semplice, ma meno WhatsApp.
- **D. Ibrido — scelto.** «Ricevuto» come **segnalibro** sulla conversazione
  (una scrittura per conversazione, solo se avanza); «letto» resta `read_at` per
  messaggio (costo zero in più).

## Il design (D)

### Dato

Due colonne su `public.conversations`:

- `user_a_delivered_at timestamptz` — fin dove l'app di `user_a` ha scaricato;
- `user_b_delivered_at timestamptz` — idem per `user_b`.

Nullable, nessun backfill necessario (vedi «Messaggi già esistenti»).

### Chi le scrive

- Nuova RPC DEFINER **`mark_chats_delivered()`**, senza argomenti: per tutte le
  conversazioni di `auth.uid()` porta il **proprio** segnalibro a
  `last_message_at`, **solo dove** `last_message_at > coalesce(segnalibro, '-infinity')`.
  Un solo statement; le conversazioni ferme non vengono toccate (zero scritture
  se non c'è nulla di nuovo). Nota: l'ultimo messaggio potrebbe essere mio — il
  segnalibro avanza lo stesso, è innocuo (vale solo per i messaggi dell'altro).
- `mark_conversation_read` porta **anche** il segnalibro di quella conversazione
  (letto implica ricevuto).

### Quando il client chiama `mark_chats_delivered()`

Quando l'app/dashboard ha davvero ricevuto i messaggi nuovi:

1. all'**avvio con sessione** (montaggio di `RealtimeSync`, app e dashboard);
2. all'arrivo in realtime di un **messaggio dell'altro** sul canale `messages`
   già aperto da `RealtimeSync` (app e dashboard) — l'app è aperta, il messaggio
   è arrivato. Vale anche per chi ha spento le notifiche della chat;
3. al **ritorno in primo piano** (AppState in app, `visibilitychange` sulla
   dashboard).

Le chiamate vanno **raggruppate** (debounce) e la RPC non scrive nulla se non
c'è niente di nuovo, per non generare scritture a raffica.

### Come si calcola lo stato (regola unica)

Funzione pura condivisa, es. `src/features/chat/messageStatus.ts`, usata da app,
dashboard e lista chat, con unit test:

```
messageStatus(message, conversation, userId):
  se il messaggio è in invio (non ancora salvato)      → "sending"
  se message.read_at != null                           → "read"
  se message.created_at <= segnalibro dell'ALTRO       → "delivered"
  altrimenti                                           → "sent"
```

Il «segnalibro dell'altro» è `user_b_delivered_at` se io sono `user_a`, e
viceversa.

### In diretta

- Aggiungere `conversations` alla publication `supabase_realtime`.
- Il thread aperto (`useChatThread`) ascolta in più:
  - `UPDATE` su `messages` filtrato per `conversation_id` → aggiorna `read_at`
    in cache (spunte colorate);
  - `UPDATE` su `conversations` filtrato per `id` → aggiorna i segnalibri in
    cache (spunte grigie doppie).
- La lista chat già si invalida sui messaggi; basta che legga i due segnalibri
  (sono colonne di `conversations`, già nel `select *`) e lo stato dell'ultimo
  messaggio (serve anche `read_at` nel select di `last`).

Nota costi: `last_message_at` cambia a ogni messaggio, quindi `conversations`
in realtime genera un evento per messaggio verso chi ascolta quella
conversazione. Volume trascurabile per una chat 1:1.

### «In invio» (🕓)

Oggi la bolla compare solo dopo il salvataggio. Per la 🕓 serve una bolla
provvisoria finché la mutation è in corso (es. dai `variables` della mutation,
senza scrivere in cache un messaggio finto). Se l'invio fallisce, la bolla
provvisoria sparisce e resta il toast d'errore di oggi.

### Aspetto

- Spunte piccole, accanto all'orario, dentro la bolla, solo sui miei messaggi.
- **Niente blu WhatsApp** (scelta del fondatore): colori della nostra palette
  che stiano bene sull'oro. Non letto (✓, ✓✓ ricevuto): `text-gold-ink` con la
  stessa opacità dell'orario; **visualizzato**: `text-gold-ink` **pieno**, senza
  opacità — è la differenza di intensità a dire «letto», come il blu su
  WhatsApp. Se la differenza risulta troppo debole in uno dei due temi, il
  builder può proporre un token dedicato (gemelli in `src/global.css` /
  `web/src/index.css` / `colors.ts`, controllati da `colorTokens.test.ts`). Mai
  `#hex` a mano.
- Accessibilità: etichetta per lo screen reader («Inviato», «Ricevuto»,
  «Visualizzato»).

### Messaggi già esistenti

Senza segnalibro: i messaggi vecchi già letti risultano «visualizzato» (hanno
`read_at`); quelli non letti risultano «inviato» finché il destinatario non apre
l'app. Nessun backfill.

### Sicurezza

- Le nuove colonne sono visibili a entrambi i partecipanti (già leggono la riga
  della conversazione). Nessun nuovo GRANT di UPDATE al client.
- `mark_chats_delivered` tocca **solo** il segnalibro di `auth.uid()` e solo
  nelle sue conversazioni.
- Aggiornare `050_surface.sql` con la nuova RPC; test SQL per: segnalibro che
  avanza solo in avanti, solo il proprio lato, nessuna scrittura senza novità,
  `mark_conversation_read` che porta anche il segnalibro.

## Lasciato al builder

- Forma esatta delle icone (Icon esistente, SVG, testo) e del token colorato,
  nel rispetto delle regole dei token.
- Dove esattamente agganciare il punto 3 (AppState in app,
  `visibilitychange` sulla dashboard) e la durata del debounce.
- Se mostrare le spunte nella lista **al posto di** «Tu:» o accanto.
- Rigenerare `src/types/database.ts` con `supabase/tests/gen-types.sh`.
- Migration nuova (mai modificare una già applicata), nominata
  `2026111800xxxx_chat_delivery.sql`.
