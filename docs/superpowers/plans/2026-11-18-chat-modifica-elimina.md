# Chat: modifica ed elimina messaggio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chi scrive può modificare (entro 15 minuti) ed eliminare (entro 48 ore) i propri messaggi di testo, in app e dashboard, con «Modificato» / «Messaggio eliminato» visibili a entrambi e il testo vecchio cancellato davvero.

**Architecture:** Due colonne su `messages` (`edited_at`, `deleted_at`) e due RPC DEFINER (`edit_message`, `delete_message`) che applicano proprietà, tipo e limiti di tempo, e riscrivono la notifica in-app nata da quel messaggio. Il client riceve le modifiche dal canale UPDATE già aperto dalle spunte; una regola pura (`messageActions.ts`) decide quali voci mostrare.

**Tech Stack:** Supabase (Postgres, RLS, realtime), React Query, Expo/React Native + NativeWind (`@/tw`), dashboard Vite+React (`web/src`), vitest, banco SQL `supabase/tests/run.sh`.

**Spec:** `docs/superpowers/specs/2026-11-18-chat-modifica-elimina-design.md`

## Global Constraints

- Su `main`, niente rami; **un commit a fine lavoro** (Task 5); non mettere in stage `docs/superpowers/plans/2026-11-17-lingue-inglese-spagnolo.md`.
- Migration nuova `supabase/migrations/20261118000100_chat_edit_delete.sql`; mai toccare quelle applicate.
- RPC `security definer set search_path = ''`, `revoke ... from public, anon`, `grant ... to authenticated`; nessun nuovo GRANT di UPDATE/DELETE su `messages` (lo verifica `050_surface.sql`, che **non** va cambiato).
- Limiti: modifica entro **15 minuti** da `created_at`, eliminazione entro **48 ore**; li decide il database.
- Messaggio eliminato: `content = ''`, `deleted_at` valorizzato; il testo originale non resta da nessuna parte (nemmeno nella notifica in-app).
- Solo propri messaggi con `kind = 'text'`.
- Codici d'errore SQL → `src/lib/errors.ts`: `message_edit_expired` → «Puoi modificare un messaggio solo nei primi 15 minuti.», `message_delete_expired` → «Puoi eliminare un messaggio solo nelle prime 48 ore.».
- Testi UI esatti: «Modifica», «Elimina», «Modificato», «Messaggio eliminato», «Modifica messaggio», «Eliminare il messaggio?», «Sparirà per tutti e due.».
- Colori solo da token; nessun `#hex`. Stringhe in italiano.
- Il banco SQL va azzerato prima di ogni giro completo: `supabase/tests/run.sh reset && supabase/tests/run.sh test`.

## Review Focus

1. **Testo vecchio nella campanella**: dopo modifica/eliminazione nessuna notifica in-app contiene ancora il vecchio testo → test SQL nel Task 1 (letta e non letta).
2. **Limite ai bordi** (14:59 sì, 15:01 no; 47:59 sì, 48:01 no) → test SQL (spostando `created_at` da superuser) nel Task 1 e unit nel Task 2.
3. **Modifica di un messaggio già eliminato** → rifiutata (`message_deleted`) nel Task 1.
4. **Lista chat con ultimo messaggio eliminato**: mostra «Messaggio eliminato», non una riga vuota né le spunte → test in `messageActions` (`previewText`) nel Task 2.
5. **Testo modificato non valido** (vuoto, solo spazi, oltre 1000 caratteri) → rifiutato da client (`messageSchema`) e server (`message_invalid`) nel Task 1.

---

### Task 1: Database — colonne, RPC, notifica

**Files:**
- Create: `supabase/migrations/20261118000100_chat_edit_delete.sql`
- Create: `supabase/tests/rls/162_chat_edit_delete.sql`
- Modify: `src/types/database.ts` (rigenerato con `supabase/tests/gen-types.sh`)
- Modify: `src/lib/errors.ts` (tre voci: `message_edit_expired`, `message_delete_expired`, `message_deleted`; `message_invalid` → «Scrivi un messaggio di al massimo 1000 caratteri.»)

**Interfaces:**
- Produces: `messages.edited_at timestamptz null`, `messages.deleted_at timestamptz null`; `public.edit_message(p_message uuid, p_content text) returns void`; `public.delete_message(p_message uuid) returns void`.

- [ ] **Step 1: Test SQL** `162_chat_edit_delete.sql` sul modello di `161_chat_delivery.sql` (`Ow` apre `c1` con `M_Emp`; `Emp` scrive). Asserzioni:
  - `Emp` modifica il proprio messaggio: `content` nuovo, `edited_at` non nullo.
  - la notifica `new_message` di `Ow` per `c1` finisce con `': ' || <testo nuovo>` e **non** contiene il vecchio testo.
  - `Ow` non modifica né elimina il messaggio di `Emp` (`not_allowed`).
  - testo vuoto / solo spazi / 1001 caratteri → `message_invalid`.
  - da superuser `created_at = now() - interval '14 minutes 59 seconds'` → modifica ok; `- interval '15 minutes 1 second'` → `message_edit_expired`.
  - eliminazione: `content = ''`, `deleted_at` non nullo, notifica di `Ow` = `<prefisso>: Messaggio eliminato`, nessuna notifica di `Ow` contiene il vecchio testo (anche marcandola letta prima).
  - eliminare due volte non dà errore; modificare un eliminato → `message_deleted`.
  - `created_at - 47:59` elimina, `- 48:01` → `message_delete_expired`.
  - una card (`kind <> 'text'`, creata come in `030_people.sql` con una richiesta di cambio turno, o inserita da superuser) → `not_allowed` su modifica ed eliminazione.
  - `tests.raises` su `update public.messages set content = 'x'` e `delete from public.messages` da `Emp` → `permission denied`.
- [ ] **Step 2: FAIL** — `supabase/tests/run.sh reset && supabase/tests/run.sh test` → `rls/162_chat_edit_delete.sql` fallisce (`column edited_at does not exist`).
- [ ] **Step 3: Migration.** Colonne; sostituire il check `messages_content_check` (verificarne il nome reale con `\d public.messages`) con `check (btrim(content) <> '' or (deleted_at is not null and content = ''))`. RPC: messaggio della conversazione in `private.my_conversation_ids()` e `sender_id = auth.uid()` e `kind = 'text'`, altrimenti `not_allowed` (errcode `42501`); `edit_message` normalizza con `btrim`, rifiuta vuoto o `> 1000` (`message_invalid`), eliminato (`message_deleted`), scaduto (`message_edit_expired`); testo uguale → nessuna scrittura. `delete_message`: già eliminato → ritorna; scaduto → `message_delete_expired`. Notifica: aggiornare le `notifications` con `type = 'new_message'`, `related_id = conversation_id`, `user_id` = l'altro partecipante, il cui `body` termina con `': ' || left(<vecchio>, 80)`, sostituendo quel suffisso con `': ' || left(<nuovo>, 80)` o `': Messaggio eliminato'`.
- [ ] **Step 4: PASS** — stesso comando → tutte le suite ok.
- [ ] **Step 5: Tipi ed errori** — `supabase/tests/gen-types.sh`; voci in `errors.ts`; `yarn vitest run tests/unit/lib/errors.test.ts && npx tsc --noEmit` → PASS.
- [ ] **Step 6: Stage.**

---

### Task 2: Regole pure delle azioni

**Files:**
- Create: `src/features/chat/messageActions.ts`
- Test: `tests/unit/chat/messageActions.test.ts`

**Interfaces:**
- Produces:
  - `export const EDIT_WINDOW_MS = 15 * 60_000; export const DELETE_WINDOW_MS = 48 * 3_600_000;` (gemelli **manuali** dei limiti SQL: commento che lo dice)
  - `export const DELETED_TEXT = "Messaggio eliminato";`
  - `export function canEdit(m: Pick<Message, "sender_id" | "kind" | "deleted_at" | "created_at">, userId: string, now: Date): boolean`
  - `export function canDelete(m: same, userId: string, now: Date): boolean`
  - `export function previewText(m: Pick<Message, "content" | "deleted_at">): string` — `DELETED_TEXT` se eliminato, altrimenti `content`.

- [ ] **Step 1: Test**: mio testo a 14:59 → `canEdit` true, a 15:01 false; a 47:59 `canDelete` true, a 48:01 false; altrui → entrambi false; `kind: "shift_change_request"` → false; eliminato → entrambi false; `previewText` di un eliminato = `"Messaggio eliminato"`.
- [ ] **Step 2: FAIL** — `yarn vitest run tests/unit/chat/messageActions.test.ts`.
- [ ] **Step 3: Implementare.**
- [ ] **Step 4: PASS.**
- [ ] **Step 5: Stage.**

---

### Task 3: Dati e hook

**Files:**
- Modify: `src/features/chat/api.ts` (`editMessage`, `deleteMessage`; `last:` della lista con `deleted_at`, tipo `lastMessage` aggiornato)
- Modify: `src/features/chat/hooks.ts` (`useEditMessage`, `useDeleteMessage`)
- Modify: `src/features/chat/useChatThread.ts` (spunte assenti sugli eliminati; esporre le due mutation)
- Test: `tests/unit/chat/chatCache.test.ts` (un caso in più)

**Interfaces:**
- Consumes: RPC del Task 1; `applyMessageUpdateToCache` (esistente).
- Produces:
  - `editMessage(messageId: string, content: string): Promise<void>`, `deleteMessage(messageId: string): Promise<void>` (rpc, `throw` su errore).
  - `useEditMessage(conversationId: string)` → mutation su `{ id: string; content: string }`; `useDeleteMessage(conversationId: string)` → mutation su `id: string`. In `onSuccess` applicano l'effetto in cache (`content`/`edited_at = now`, oppure `content: ""`/`deleted_at = now`) e invalidano `qk.chat.conversationsAll`.
  - `useChatThread` restituisce in più `edit` e `remove` (le due mutation); `statusOf` ritorna `null` per i messaggi con `deleted_at`.

- [ ] **Step 1: Test** in `chatCache.test.ts`: `applyMessageUpdateToCache` con `{ content: "", deleted_at: "…" }` lascia `content` vuoto e `deleted_at` valorizzato (lo spread non deve tenere il vecchio testo).
- [ ] **Step 2: Implementare** api, hook, `useChatThread`.
- [ ] **Step 3: PASS** — `yarn vitest run tests/unit/chat && npx tsc --noEmit`.
- [ ] **Step 4: Stage.**

---

### Task 4: Interfaccia — app e dashboard

**Files:**
- Modify: `src/features/chat/ChatThread.tsx` (pressione lunga, `BottomSheet`, `ConfirmModal`, composer in modalità modifica, bolla eliminata/modificata)
- Modify: `src/features/chat/ConversationList.tsx` (`previewText`; niente spunte se l'ultimo è eliminato)
- Modify: `web/src/pages/Chat.tsx` (`MoreMenu` sulla bolla propria, `ConfirmDialog`, composer in modalità modifica, `TextBubble` eliminata/modificata, lista con `previewText`)

**Interfaces:**
- Consumes: `canEdit`, `canDelete`, `previewText`, `DELETED_TEXT` (Task 2); `edit`, `remove`, `statusOf` (Task 3); `userErrorMessage` da `@/lib/errors` per i toast d'errore.

- [ ] **Step 1: App.** `MessageBubble` riceve `edited`, `deleted` e `onLongPress` (solo se `canEdit || canDelete` con `new Date()` al momento della pressione). Eliminata: testo `DELETED_TEXT` in corsivo `opacity-70`, niente spunte. Modificata: «Modificato» prima dell'orario, stesso stile. `BottomSheet` con le voci consentite. Modifica: stato `editing: Message | null`; barra sopra il composer «Modifica messaggio» + ✕; testo precaricato; invio → `messageSchema` poi `edit.mutate`; esce dalla modalità al successo. Elimina: `ConfirmModal` (`title` «Eliminare il messaggio?», `message` «Sparirà per tutti e due.», `confirmLabel` «Elimina», `destructive`). Errori → toast con `userErrorMessage(err)`.
- [ ] **Step 2: Dashboard.** Stesso comportamento: `MoreMenu` sulla propria bolla di testo con le voci consentite, `ConfirmDialog` con gli stessi testi, barra di modifica sopra il form.
- [ ] **Step 3: Lista** (app e dashboard): anteprima da `previewText(last)`; spunte solo se non eliminato.
- [ ] **Step 4: Verifica** — `npx tsc --noEmit && npx tsc --noEmit -p web && yarn lint && yarn vitest run tests/unit/theme tests/unit/glossary.test.ts tests/unit/chat` → PASS; `yarn -s vite build web --outDir <scratchpad>/webdist --emptyOutDir` e `npx expo export --platform ios --output-dir <scratchpad>/iosdist` → ok.
- [ ] **Step 5: Stage.**

---

### Task 5: Documentazione, verifica completa, commit

**Files:**
- Modify: `AGENTS.md` («La chat»: punto «Modifica ed elimina» — RPC, limiti 15 min / 48 h gemelli di `messageActions.ts`, testo cancellato davvero anche dalla notifica in-app, push non richiamabili)
- Modify: `TASKS.md` (voce «da rilasciare» con la migration `20261118000100` e la prova a mano)

- [ ] **Step 1: Documentazione.**
- [ ] **Step 2: Verifica completa** — `supabase/tests/run.sh reset && supabase/tests/run.sh test && yarn vitest run && npx tsc --noEmit && npx tsc --noEmit -p web && yarn lint` → tutto PASS.
- [ ] **Step 3: Commit** di migration, test, codice, docs, spec e piano: `feat(chat): modifica ed elimina messaggio` con la riga `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Niente push.
