# Chat: spunte inviato, ricevuto, visualizzato — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sotto i propri messaggi di chat, in app e dashboard, mostrare 🕓 in invio / ✓ inviato / ✓✓ ricevuto / ✓✓ visualizzato, aggiornati in diretta.

**Architecture:** «Ricevuto» è un segnalibro per persona su `conversations` (`user_a_delivered_at`, `user_b_delivered_at`) avanzato dalla RPC `mark_chats_delivered()` — una scrittura per conversazione, solo se avanza. «Letto» resta `messages.read_at` di oggi. Una funzione pura `messageStatus` decide la spunta per app, dashboard e lista; il thread ascolta in realtime gli UPDATE di `messages` e `conversations`.

**Tech Stack:** Supabase (Postgres, RLS, realtime), React Query, Expo/React Native + NativeWind (`@/tw`), dashboard Vite+React (`web/src`), vitest, banco SQL `supabase/tests/run.sh`.

**Spec:** `docs/superpowers/specs/2026-11-18-chat-spunte-design.md`

## Global Constraints

- Lavorare su `main`, niente worktree né rami; **un solo commit a fine lavoro** (preferenza del fondatore): i passi «Commit» sotto sono solo `git add` di stage, il commit è nel Task 6. Non mettere in stage `docs/superpowers/plans/2026-11-17-lingue-inglese-spagnolo.md` (di un'altra sessione).
- Migration **nuova** `supabase/migrations/20261118000000_chat_delivery.sql`; mai toccare una migration già applicata.
- Scritture solo da RPC `security definer set search_path = ''`; nessun GRANT di UPDATE su `conversations` al client.
- Nessuna scrittura per messaggio in più: il «ricevuto» non va mai su `messages`.
- Conferme **sempre accese**, nei due sensi, nessun interruttore.
- Nessuna spunta sulle card (`message.kind <> 'text'`).
- Colori solo da token: non letto = `text-gold-ink` con la stessa opacità dell'orario (`opacity-70`); visualizzato = `text-gold-ink` pieno. Mai `#hex`/`rgba(` in `src/` (`tests/unit/theme/colorTokens.test.ts`).
- Stringhe utente in italiano; etichette accessibili esatte: «In invio», «Inviato», «Ricevuto», «Visualizzato».
- `src/types/database.ts` solo rigenerato con `supabase/tests/gen-types.sh`, mai a mano.
- Lint: `yarn lint`; tipi: `npx tsc --noEmit`.

## Review Focus

1. **Segnalibro che torna indietro** (due dispositivi, chiamate fuori ordine): `mark_chats_delivered` non deve mai abbassare un segnalibro → test SQL «non arretra» nel Task 1.
2. **Ultimo messaggio mio**: il segnalibro avanza anche se l'ultimo messaggio è del chiamante; i miei messaggi non devono risultare «ricevuti» per questo → `messageStatus` usa il segnalibro dell'**altro** (test «usa il lato dell'altro» nel Task 2).
3. **Lettura senza consegna registrata** (`read_at` valorizzato, segnalibro nullo — messaggi vecchi): deve risultare «visualizzato», non «inviato» → test nel Task 2.
4. **Raffica di messaggi in arrivo**: dieci INSERT in pochi secondi devono produrre **una** RPC → test con fake timers nel Task 3.
5. **Stesso istante** (`created_at` = segnalibro): conta come ricevuto (`<=`) → test nel Task 2; e in SQL più messaggi nella stessa transazione hanno lo stesso `now()` → coperto dal test SQL del Task 1.

---

### Task 1: Database — segnalibri, RPC, realtime

**Files:**
- Create: `supabase/migrations/20261118000000_chat_delivery.sql`
- Create: `supabase/tests/rls/161_chat_delivery.sql`
- Modify: `supabase/tests/rls/050_surface.sql` (solo se l'elenco delle funzioni `public` concesse ad `authenticated` è enumerato lì: aggiungere `mark_chats_delivered`)
- Modify: `src/types/database.ts` (rigenerato)

**Interfaces:**
- Produces: colonne `conversations.user_a_delivered_at timestamptz null`, `conversations.user_b_delivered_at timestamptz null`; RPC `public.mark_chats_delivered() returns integer` (numero di conversazioni avanzate); `public.mark_conversation_read(p_conversation uuid)` che avanza anche il segnalibro; `conversations` nella publication `supabase_realtime`.

- [ ] **Step 1: Scrivere il test SQL** `161_chat_delivery.sql`, sullo schema di `030_people.sql` (blocco `do $$`, `tests.login/logout/id/eq/ok/raises`, seed `W1`, `Ow`, `Emp`, `Emp2`, `M_Emp`). Asserzioni:
  - `Ow` apre `c1 := open_conversation(p_member => tests.id('M_Emp'))`; `Emp` inserisce 2 messaggi; da `Ow`: `mark_chats_delivered()` = 1 e il segnalibro del lato di `Ow` (`case when user_a = tests.id('Ow') then user_a_delivered_at else user_b_delivered_at end`) = `last_message_at`; il lato di `Emp` resta nullo.
  - seconda chiamata subito dopo = 0 («nessuna scrittura senza novità»).
  - «non arretra»: da superuser (`tests.logout()`) porta il segnalibro di `Ow` a `last_message_at + interval '1 hour'`, poi da `Ow` `mark_chats_delivered()` = 0 e il valore è invariato.
  - `Emp2` chiama `mark_chats_delivered()` = 0 e i segnalibri di `c1` non cambiano (solo le proprie conversazioni).
  - `mark_conversation_read(c1)` da `Emp` dopo un messaggio di `Ow` porta il segnalibro di `Emp` a `last_message_at`.
  - `tests.raises` su `update public.conversations set user_a_delivered_at = now()` da `Emp` → `'permission denied'`.
  - `select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'conversations'` = 1 (salta se la publication non esiste nel banco, come in `20260920001300`).

- [ ] **Step 2: Verificare che fallisca**

Run: `supabase/tests/run.sh reset && supabase/tests/run.sh test`
Expected: FAIL in `rls/161_chat_delivery.sql` (`function public.mark_chats_delivered() does not exist`).

- [ ] **Step 3: Scrivere la migration.** Colonne nullable, nessun backfill. `mark_chats_delivered()`: un solo `update public.conversations` che, per le righe con `id in (select private.my_conversation_ids())` e `last_message_at` maggiore del proprio segnalibro (`coalesce(..., '-infinity')`), imposta il proprio lato (`user_a_delivered_at` se `user_a = auth.uid()`, altrimenti `user_b_delivered_at`) a `last_message_at` — mai `now()`, mai un valore minore. Restituisce `row_count`. `grant execute ... to authenticated`, `revoke ... from public, anon`. `create or replace` di `mark_conversation_read` con il corpo di `20260920001000_chat_absences.sql:208-220` più l'avanzamento con `greatest(coalesce(segnalibro, '-infinity'), last_message_at)` sulla sola `p_conversation`. Aggiunta a `supabase_realtime` con la stessa guardia `if exists (select 1 from pg_publication ...)`. Intestazione della migration in italiano con il perché (segnalibro = una scrittura per conversazione; `read_at` invariato).

- [ ] **Step 4: Verificare che passi**

Run: `supabase/tests/run.sh reset && supabase/tests/run.sh test`
Expected: tutte le suite PASS, comprese `030_people.sql` e `050_surface.sql`.

- [ ] **Step 5: Rigenerare i tipi**

Run: `supabase/tests/gen-types.sh && npx tsc --noEmit`
Expected: `database.ts` contiene `user_a_delivered_at`, `user_b_delivered_at` e `mark_chats_delivered: { Args: never; Returns: number }`; tsc pulito.

- [ ] **Step 6: Stage** — `git add supabase/migrations/20261118000000_chat_delivery.sql supabase/tests/rls/161_chat_delivery.sql supabase/tests/rls/050_surface.sql src/types/database.ts`

---

### Task 2: Regola unica dello stato

**Files:**
- Create: `src/features/chat/messageStatus.ts`
- Test: `tests/unit/chat/messageStatus.test.ts`

**Interfaces:**
- Consumes: tipi `Message`, `Conversation` da `src/features/chat/api.ts` (con le colonne del Task 1).
- Produces:
  - `export type MessageStatus = "sending" | "sent" | "delivered" | "read";`
  - `export function otherDeliveredAt(conversation: Pick<Conversation, "user_a" | "user_a_delivered_at" | "user_b_delivered_at">, userId: string): string | null`
  - `export function messageStatus(message: Pick<Message, "created_at" | "read_at">, otherDelivered: string | null): Exclude<MessageStatus, "sending">`
  - `export const MESSAGE_STATUS_LABEL: Record<MessageStatus, string>` = `{ sending: "In invio", sent: "Inviato", delivered: "Ricevuto", read: "Visualizzato" }`

- [ ] **Step 1: Scrivere i test**

```ts
describe("messageStatus", () => {
  const msg = { created_at: "2026-11-18T10:00:00Z", read_at: null };
  it("inviato senza segnalibro", () => expect(messageStatus(msg, null)).toBe("sent"));
  it("inviato se il segnalibro è prima", () => expect(messageStatus(msg, "2026-11-18T09:59:59Z")).toBe("sent"));
  it("ricevuto allo stesso istante", () => expect(messageStatus(msg, "2026-11-18T10:00:00Z")).toBe("delivered"));
  it("visualizzato vince anche senza segnalibro", () =>
    expect(messageStatus({ ...msg, read_at: "2026-11-18T10:05:00Z" }, null)).toBe("read"));
});
describe("otherDeliveredAt", () => {
  const c = { user_a: "a", user_a_delivered_at: "A", user_b_delivered_at: "B" };
  it("usa il lato dell'altro (io sono a)", () => expect(otherDeliveredAt(c, "a")).toBe("B"));
  it("usa il lato dell'altro (io sono b)", () => expect(otherDeliveredAt(c, "b")).toBe("A"));
});
```

Confronto su `Date.parse`, non su stringhe (i timestamp di Postgres e di JS hanno formati diversi: aggiungere un caso `"2026-11-18T10:00:00+00:00"` vs `"2026-11-18T10:00:00.000Z"` → `delivered`).

- [ ] **Step 2: Verificare che falliscano** — Run: `yarn vitest run tests/unit/chat/messageStatus.test.ts` → FAIL (modulo mancante).
- [ ] **Step 3: Implementare** in `src/features/chat/messageStatus.ts`.
- [ ] **Step 4: Verificare che passino** — stesso comando → PASS.
- [ ] **Step 5: Stage** dei due file.

---

### Task 3: Segnare «ricevuto» — scheduler e collegamenti

**Files:**
- Create: `src/features/chat/delivery.ts`
- Modify: `src/features/chat/api.ts` (aggiungere `markChatsDelivered`)
- Modify: `src/features/realtime/RealtimeSync.tsx` (i due handler `INSERT` su `messages`, righe ~273 e ~341, più un effetto di montaggio)
- Modify: `src/providers/AppProviders.tsx` (listener AppState esistente)
- Modify: `web/src/App.tsx` o `web/src/AppLayout.tsx` (dove è montato `RealtimeSync`: listener `visibilitychange`)
- Test: `tests/unit/chat/delivery.test.ts`

**Interfaces:**
- Produces:
  - `api.ts`: `export async function markChatsDelivered(): Promise<number>` (rpc `mark_chats_delivered`, `throw` su `error`).
  - `delivery.ts`: `export function createDeliveryScheduler(mark: () => Promise<unknown>, delayMs: number): { request(): void; cancel(): void }` — debounce in coda: N `request()` entro `delayMs` → una sola `mark()`; errori di `mark` inghiottiti (best effort, nessun toast).
  - `delivery.ts`: `export const requestChatDelivery: () => void` — istanza singleton con `markChatsDelivered` e `delayMs = 1500`.

- [ ] **Step 1: Test con `vi.useFakeTimers()`**: «una raffica fa una chiamata» (10 `request()` a 100 ms l'uno dall'altro, poi `advanceTimersByTime(1500)` → `mark` chiamata 1 volta); «due raffiche lontane fanno due chiamate»; «un errore di mark non rompe le richieste successive» (`mark` rigetta la prima volta, la seconda raffica chiama ancora); «cancel annulla la chiamata in attesa».
- [ ] **Step 2: Verificare che falliscano** — `yarn vitest run tests/unit/chat/delivery.test.ts` → FAIL.
- [ ] **Step 3: Implementare** `createDeliveryScheduler`, `requestChatDelivery`, `markChatsDelivered`.
- [ ] **Step 4: Verificare che passino** — stesso comando → PASS.
- [ ] **Step 5: Collegare** i tre momenti:
  - `RealtimeSync`: in entrambi gli handler `INSERT` su `messages`, se `(payload.new as Message).sender_id !== userId` → `requestChatDelivery()`; un `useEffect(() => requestChatDelivery(), [userId])` all'avvio.
  - App: nel listener AppState di `AppProviders`, su `"active"` → `requestChatDelivery()` (accanto a `refreshOnForeground`).
  - Dashboard: `document.addEventListener("visibilitychange", …)` quando `document.visibilityState === "visible"` → `requestChatDelivery()`, nel componente che monta `RealtimeSync`, con rimozione al cleanup.
- [ ] **Step 6: Verifica** — `npx tsc --noEmit && yarn lint` puliti.
- [ ] **Step 7: Stage** dei file toccati.

---

### Task 4: Spunte in diretta nel thread e nella lista

**Files:**
- Modify: `src/features/chat/hooks.ts` (helper di cache)
- Modify: `src/features/chat/useChatThread.ts` (due nuovi `.on(...)` sullo stesso canale; esporre lo stato)
- Modify: `src/features/chat/api.ts` (`getConversationsPage`: `last:messages!inner(content, created_at, sender_id, read_at, kind)`; tipo `lastMessage` con `read_at` e `kind`)
- Test: `tests/unit/chat/chatCache.test.ts`

**Interfaces:**
- Consumes: `messageStatus`, `otherDeliveredAt`, `MessageStatus` (Task 2).
- Produces:
  - `hooks.ts`: `export function applyMessageUpdateToCache(qc: QueryClient, message: Message): void` — sostituisce per id nelle pagine di `qk.chat.messages(message.conversation_id)`; no-op se assente.
  - `hooks.ts`: `export function applyConversationUpdateToCache(qc: QueryClient, row: Conversation): void` — fonde i campi di `row` nella cache `qk.chat.conversation(row.id)` (quella di `useConversation`, letta da `useChatThread`) senza perdere `other`; no-op se assente.
  - `useChatThread` restituisce in più `statusOf: (m: Message) => MessageStatus | null` (null per messaggi altrui e per `kind !== "text"`) e `pending: string | null` (testo in invio, da `send.isPending ? send.variables : null`).

- [ ] **Step 1: Test** su `QueryClient` reale: `applyMessageUpdateToCache` aggiorna `read_at` del messaggio giusto nella seconda pagina e lascia intatti gli altri; no-op senza cache. `applyConversationUpdateToCache` aggiorna `user_b_delivered_at` e conserva `other`.
- [ ] **Step 2: FAIL** — `yarn vitest run tests/unit/chat/chatCache.test.ts`.
- [ ] **Step 3: Implementare** gli helper e, in `useChatThread`, sullo stesso canale `chat:${conversationId}`: `.on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: \`conversation_id=eq.${conversationId}\` }, p => applyMessageUpdateToCache(qc, p.new as Message))` e `.on(… { event: "UPDATE", table: "conversations", filter: \`id=eq.${conversationId}\` }, p => applyConversationUpdateToCache(qc, p.new as Conversation))`. La ri-sottoscrizione invalida già i messaggi; aggiungere l'invalidazione della conversazione.
- [ ] **Step 4: PASS** — test + `npx tsc --noEmit`.
- [ ] **Step 5: Stage.**

---

### Task 5: L'aspetto — app e dashboard

**Files:**
- Modify: `src/components/ui/Icon.tsx` (nuova `IconName` `"checkDouble"`; `"check"` e `"clock"` esistono già)
- Create: `src/features/chat/MessageTicks.tsx`
- Modify: `src/features/chat/ChatThread.tsx` (`MessageBubble` riga 20: riga orario + spunte; bolla provvisoria con `pending`)
- Modify: `src/features/chat/ConversationList.tsx:23-25` (spunte prima dell'anteprima quando l'ultimo messaggio è mio e `kind === "text"`, al posto di «Tu: »)
- Modify: `web/src/pages/Chat.tsx` (bolla riga ~372-410 e lista riga ~93-127; SVG inline nel file o in `web/src/ui/`, stessi colori/token)

**Interfaces:**
- Consumes: `statusOf`, `pending` (Task 4); `MESSAGE_STATUS_LABEL`, `messageStatus`, `otherDeliveredAt` (Task 2).
- Produces: `export function MessageTicks({ status }: { status: MessageStatus }): JSX.Element` — `sending` → `clock`, `sent` → `check`, `delivered`/`read` → `checkDouble`; colore `text-gold-ink`, `opacity-70` tranne `read`; `accessibilityLabel = MESSAGE_STATUS_LABEL[status]`. Nella lista (sfondo non oro) usare lo stesso schema con `text-t4` attenuato / `text-gold` pieno per `read`.

- [ ] **Step 1: Implementare** icona, `MessageTicks`, bolla app, bolla provvisoria (testo `pending` + 🕓, allineata come le proprie; sparisce a fine mutation — in caso d'errore resta il toast di oggi), lista app.
- [ ] **Step 2: Implementare** lo stesso sulla dashboard (`aria-label` con le stesse etichette).
- [ ] **Step 3: Verifica statica** — Run: `npx tsc --noEmit && yarn lint && yarn vitest run tests/unit/theme tests/unit/glossary.test.ts tests/unit/chat` → tutto PASS (nessun colore a mano, glossario ok).
- [ ] **Step 4: Verifica a mano sulla dashboard** (`yarn web` o dev server di `web/`) con due account del seed locale in due browser: invio → ✓; l'altro apre la dashboard → ✓✓ grigie senza ricaricare; apre il thread → ✓✓ piene; tema chiaro e scuro leggibili. Annotare l'esito; se la differenza attenuato/pieno è poco visibile in un tema, proporre un token dedicato (gemelli in `src/global.css`, `web/src/index.css`, `src/constants/colors.ts`) invece di forzare.
- [ ] **Step 5: Stage.**

---

### Task 6: Documentazione, verifica finale, commit

**Files:**
- Modify: `AGENTS.md` (sezione «La chat»: un punto «Spunte» — segnalibro per persona su `conversations` via `mark_chats_delivered`, `read_at` per il letto, regola unica `messageStatus.ts`, sempre accese, niente su `messages`)
- Modify: `TASKS.md` (voce: migration `20261118000000` da rilasciare, prova a mano su app nativa da fare)

- [ ] **Step 1: Aggiornare la documentazione.**
- [ ] **Step 2: Verifica completa** — Run: `supabase/tests/run.sh test && yarn vitest run && npx tsc --noEmit && yarn lint` → tutto PASS; incollare l'esito.
- [ ] **Step 3: Commit unico** (solo i file di questo lavoro + spec e piano):

```bash
git add AGENTS.md TASKS.md docs/superpowers/specs/2026-11-18-chat-spunte-design.md docs/superpowers/plans/2026-11-18-chat-spunte.md
git commit -m "feat(chat): spunte inviato, ricevuto e visualizzato

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Niente push finché il fondatore non lo chiede.
