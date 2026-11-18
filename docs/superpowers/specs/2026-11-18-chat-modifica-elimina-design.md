# Chat: modifica ed elimina messaggio — design

2026-11-18. Decisioni prese con il fondatore in conversazione. Segue le spunte
(`2026-11-18-chat-spunte-design.md`) e ne riusa il realtime.

## Perché

Il fondatore vuole entrambe le cose:

1. **Correggere** un errore di battitura;
2. **Ritirare** un messaggio sbagliato (persona sbagliata, informazione sbagliata).

Modello: WhatsApp.

## Obiettivi

- Sui **propri messaggi di testo**: **Modifica** ed **Elimina**, in app
  (pressione lunga sulla bolla) e dashboard (menu sulla bolla).
- **Modifica**: il testo cambia per entrambi; accanto all'orario «Modificato».
  Entro **15 minuti** dall'invio.
- **Elimina**: per entrambi, al posto della bolla «Messaggio eliminato».
  Entro **48 ore** dall'invio. Con conferma.
- **In diretta** per l'altra persona, senza ricaricare.
- La **lista chat** mostra «Messaggio eliminato» se l'ultimo è stato eliminato,
  e il testo nuovo se è stato modificato.

## Non obiettivi

- Niente su **card** del cambio turno (`kind <> 'text'`) né sui messaggi altrui.
- Niente «elimina solo per me».
- Niente richiamo delle **push** già arrivate sui telefoni (impossibile).
- Niente cronologia delle modifiche.
- Il conteggio dei non letti non cambia: un messaggio eliminato non letto conta
  finché non si apre il thread (come oggi, come WhatsApp).

## Anti-obiettivi

- **Conservare il testo originale** da qualche parte (scelta del fondatore:
  «cancellalo davvero, come WhatsApp»). Né colonna nascosta, né log, né la
  notifica in-app con il vecchio testo.
- Modifiche **senza traccia**: una modifica o un'eliminazione si vede sempre
  («Modificato», «Messaggio eliminato»).
- Limiti di tempo decisi dal client: li applica il database.

## Vincoli

- Scritture solo da RPC DEFINER con `search_path = ''`; oggi su `messages` il
  client ha solo INSERT (`content`, `conversation_id`, `sender_id`). Nessun
  GRANT di UPDATE/DELETE in più (`supabase/tests/rls/050_surface.sql` lo
  verifica).
- `messages.content` è `not null` con `check (btrim(content) <> '')`.
- La notifica `new_message` (una per conversazione finché non letta) ha come
  `body` `<nome>: <primi 80 caratteri>`; la scrive `notify_on_new_message`
  (ultima versione da cercare nelle migration, `20260920001800` o successive).
- Il thread ascolta già `UPDATE` su `messages` filtrato per conversazione
  (`useChatThread` → `applyMessageUpdateToCache`), dalle spunte.
- Migration nuova; mai toccare quelle applicate.

## Approcci considerati

- **A. Il messaggio resta, il testo sparisce — scelto.** Colonne `edited_at`,
  `deleted_at`; RPC `edit_message` e `delete_message` con controlli e limiti di
  tempo nel database. Arriva come UPDATE, già ascoltato in diretta.
- **B. DELETE della riga.** Niente «Messaggio eliminato»; e con la replica
  identity di default un DELETE in realtime porta solo l'id, quindi il filtro
  per conversazione non lo recapita al thread. Scartato.
- **C. UPDATE diretto dal client** con policy RLS e trigger per i limiti. Contro
  la regola «scritture dalle RPC», limiti più fragili. Scartato.

## Il design

### Dato

- `messages.edited_at timestamptz` — ultima modifica, null se mai modificato.
- `messages.deleted_at timestamptz` — null se non eliminato.
- Il messaggio eliminato ha `content = ''` (stringa vuota, non null: il tipo
  resta `string` in tutto il client). Il check diventa: testo non vuoto,
  **oppure** eliminato con testo vuoto. *(Scelta di Claude: evita di rendere
  `content` nullable in tutto il codice.)*

### RPC

- `edit_message(p_message uuid, p_content text) returns void`
  - rifiuta se: non è mio (`not_allowed`), non è `text`, è eliminato,
    `now() > created_at + interval '15 minutes'` (`message_edit_expired`), testo
    vuoto o uguale. Testo normalizzato come all'invio (stessi limiti di
    lunghezza di `messageSchema`).
  - imposta `content` e `edited_at = now()`.
- `delete_message(p_message uuid) returns void`
  - rifiuta se: non è mio, non è `text`, `now() > created_at + interval '48 hours'`
    (`message_delete_expired`). Già eliminato → nessun errore (idempotente).
  - imposta `content = ''`, `deleted_at = now()`; `edited_at` invariato.
- Entrambe: la conversazione dev'essere fra le mie (`private.my_conversation_ids()`).
  Codici d'errore tradotti in `src/lib/errors.ts` («Puoi modificare un messaggio
  solo nei primi 15 minuti», «Puoi eliminare un messaggio solo nelle prime 48 ore»).

### La notifica in-app (cancellare davvero)

Se una notifica `new_message` del destinatario per quella conversazione ha il
`body` costruito da quel messaggio (stesso suffisso `': ' || left(<testo
originale>, 80)`), letta o no:

- su **modifica** → il body prende il testo nuovo;
- su **eliminazione** → il body diventa `<nome>: Messaggio eliminato`.

Le push già consegnate restano: non si possono richiamare.

### Client

- `api.ts`: `editMessage(id, content)`, `deleteMessage(id)`.
- Le mutation aggiornano la cache del thread (riusando
  `applyMessageUpdateToCache`) e invalidano la lista chat; l'altra persona
  riceve l'UPDATE in diretta dal canale già aperto.
- Regola pura condivisa (es. `src/features/chat/messageActions.ts`, con test):
  `canEdit(message, userId, now)` e `canDelete(message, userId, now)`, gemella
  **manuale** dei limiti SQL (15 min / 48 h) — serve solo a mostrare o
  nascondere le voci; l'ultima parola è del database.

### Aspetto

- **Bolla eliminata** (per entrambi): «Messaggio eliminato» in corsivo,
  attenuato, con l'orario; niente spunte, niente menu.
- **Bolla modificata**: «Modificato» prima dell'orario, stesso stile dell'orario.
- **App**: pressione lunga sulla propria bolla di testo → `BottomSheet` con
  «Modifica» (se entro 15 min) ed «Elimina» (se entro 48 h). Modifica: il
  composer passa in modalità modifica (barra sopra con «Modifica messaggio» e
  ✕ per annullare, testo precaricato, invio = salva). Elimina: `ConfirmModal`
  «Eliminare il messaggio? Sparirà per tutti e due.».
- **Dashboard**: menu sulla bolla (es. `MoreMenu` al passaggio del mouse) con le
  stesse voci; stessa modalità modifica del composer; `ConfirmDialog` per
  eliminare.
- **Lista chat**: ultimo messaggio eliminato → «Messaggio eliminato» (anche con
  le spunte: un messaggio eliminato non ne mostra).
- Spunte: una modifica non le cambia; un messaggio eliminato non ne ha.

### Test

- SQL: modifica ed eliminazione dei propri messaggi; rifiuto su messaggi altrui,
  card, oltre i limiti (manipolando `created_at` da superuser); idempotenza
  dell'eliminazione; `content` vuoto dopo l'eliminazione e nessuna traccia del
  vecchio testo nella notifica in-app; nessun nuovo GRANT.
- Unit: `canEdit` / `canDelete` ai bordi (14:59, 15:00, 47:59, 48:00).

## Lasciato al builder

- Forma esatta del menu sulla dashboard e dell'icona di modifica.
- Messaggio d'errore se il tempo scade mentre il menu è aperto (il server
  rifiuta, la UI mostra il toast tradotto).
- Il nome della migration (`20261118000100_chat_edit_delete.sql`).
- Aggiornare `AGENTS.md` («La chat») e `TASKS.md`.
