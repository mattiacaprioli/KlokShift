# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

---

# KlokShift

Gestione dei turni per il settore dell'ospitalità (mercato italiano): ristoranti, hotel, catering, discoteche, pub e agenzie di eventi. Le **sedi** organizzano i turni con il proprio organico; i **professionisti** confermano i turni assegnati, tengono il conto delle ore e costruiscono la propria reputazione. Niente Stripe nel MVP.

> Il marketplace (professionisti che cercano turni e si candidano ad annunci) è stato rimosso dal codice il 2026-09-12 e dal DB il 2026-09-20 (`applications`, `shift_kind`, i `notification_type` `application_*` e i campi da annuncio dei turni non esistono più): non va riesumato senza una decisione di prodotto.

⚠️ **Vocabolario**: nelle stringhe utente si usa **professionista** (non "cameriere") e **sede** (non "locale"/"ristorante"/"ristoratore"), perché il prodotto non è più solo per la ristorazione. I nomi interni restano `waiter`/`manager` (rotte, colonne della chat, tipi): non rinominarli.

## Modello: chi è chi (2026-09-20)

Un solo asse per **titolare**, **collaboratore** e **dipendente**. Dettagli e regole in `supabase/README.md`.

```
profiles           l'account — una persona, valida fra più aziende. Niente ruolo, niente piano.
workspaces         l'azienda (è lei ad avere il piano)
venues             le sedi (workspace_id)
workspace_members  UNA persona nell'azienda: authority owner | collaborator | none,
                   status invited | active | left, 5 permessi + ambito (tutte le sedi | elenco)
venue_members      dove lavora (l'organico) — il bersaglio di shift_assignments.venue_member_id
```

- **authority** (cosa puoi fare) e **organico** (dove lavori) sono ortogonali: un titolare in turno è un membro `owner` con una riga in `venue_members`, non un caso speciale. Un account può stare in più aziende con authority diverse.
- I permessi del collaboratore stanno **sul membro**, non per sede, più un ambito: tutte le sedi (anche le future) o un elenco (`member_scope`).
- Il «cappello» con cui si usa l'app (gestione / lavoro) **non è un ruolo**: si ricava dalle appartenenze (`get_my_context()` → `useOwnerVenues()` e `useViewMode()`).
- `staff_people`, `staff_members` e `venue_access` **non esistono più**. I tipi di dominio storici (`OwnerPerson`, `StaffMember`, …) restano in `src/features/staff/types.ts` e li **produce** il data layer: `StaffPerson.id` è un member id, `StaffMember.id` è un venue member id — non confonderli.
- Le **scritture passano dalle RPC** (atomiche, con errori `raise exception '<codice>'` tradotti in `src/lib/errors.ts`). INSERT/UPDATE/DELETE diretti sono revocati tranne l'elenco in `supabase/tests/rls/050_surface.sql`. ⚠️ Un update diretto che la RLS scarta torna 204 **senza errore**: `.select()` e zero righe = errore.

## Stack
| Categoria | Tecnologia |
|-----------|-----------|
| Framework | React 19 + React Native 0.85 + **Expo SDK 56** |
| Routing | **Expo Router** (file-based, gruppi `(auth)`/`(waiter)`/`(manager)`) |
| Backend | **Supabase** (auth, DB, realtime, storage) — no GraphQL/Relay |
| Styling | **NativeWind v5** (Tailwind v4 CSS-first) via wrapper `@/tw` |
| UI | Componenti React Native + primitive in `src/components/ui/` |
| Lint | `expo lint` (eslint) — nessun Biome/Prettier |
| Lingua | Stringhe utente in **italiano inline** (no lib i18n) |
| Package manager | **yarn** (`yarn.lock`) — niente npm |

## Comandi
```bash
yarn start                # Expo dev server
yarn ios                  # iOS simulator
yarn android              # Android emulator
yarn web                  # web
yarn lint                 # expo lint src web/src web-site/src (eslint) — bloccante in CI
                          #   i path vanno nominati: senza, expo lint salta web/ e web-site/
yarn site:dev             # sito vetrina (web-site/) — vedi web-site/README.md
yarn add <pkg>            # dipendenze (oppure `npx expo install <pkg>`)
npx tsc --noEmit          # type-check
npx expo export --platform ios   # verifica bundle
```

## Struttura
```
src/
├── app/                  # Expo Router
│   ├── _layout.tsx       # AuthProvider + RootNavigator (Stack.Protected) + SplashScreen
│   ├── (auth)/           # welcome, login, signup
│   ├── (waiter)/         # home camerieri (M5)
│   ├── (manager)/        # index, venue, shift/new, shift/[id]
│   └── (dev)/            # components.tsx — demo design system
├── components/ui/        # primitive: GoldButton, GhostButton, BlurCard, Card,
│                         #   Avatar, Pill, Chip, Input, SectionHeader, EmptyState,
│                         #   ShimmerText, Icon, Logo, LogoBadge, Mono, Display
├── lib/                  # supabase.ts, auth.tsx, manager.ts, format.ts, cn.ts
├── tw/                   # wrapper CSS-class (index/image/animated) per NativeWind
├── types/database.ts     # tipi DB generati
├── constants/theme.ts    # colori, spacing, font (palette AURA)
└── global.css            # import Tailwind v4 + @theme token

web/        # dashboard desktop delle sedi (Vite+React, /app/ su Pages)
web-site/   # sito vetrina pubblico + pagine legali (radice su Pages)
web-review/ # recensioni cliente (sospese, sotto /recensioni/)
```

⚠️ Il copy del sito vetrina sta tutto in `web-site/src/content/it.ts` e non può
nominare recensioni, candidature, paghe o prezzi: vedi `web-site/README.md`.

## Path alias
`@/` → `src/`. Es. `import { cn } from "@/lib/cn"`, `import { View, Text } from "@/tw"`.

## Auth & navigazione
- Pattern ufficiale Expo Router v56: `Stack.Protected` con 4 guard — `!session` → `(auth)`, vista `manager` → `(manager)`, vista `waiter` senza onboarding → `(onboarding)`, con onboarding → `(waiter)`. Nessun `index.tsx` root.
- La vista la dà `useViewMode()`: si ricava dalle appartenenze, **non** da un ruolo sul profilo. Chi ha entrambi i cappelli sceglie con l'interruttore; l'ultima vista è ricordata (`viewModeStorage`) per non aspettare la rete allo splash. `user_metadata.intent` è solo il suggerimento della registrazione.
- `AuthProvider`/`useAuth()` in `src/lib/auth.tsx`: `getSession()` + `onAuthStateChange` → `ensureProfile()`. Il profilo di norma lo crea il **trigger su `auth.users`** (`private.handle_auth_user`), che non deve mai sollevare; l'insert nel client è la rete di sicurezza.
- ⚠️ **"Confirm email" su Supabase Auth non si disattiva.** L'aggancio automatico (`private.link_member_invites`) collega un account alla scheda che un'azienda ha preparato per quell'indirizzo. Il controllo `email_confirmed_at is not null` è l'unica cosa che separa «ti colleghiamo alla tua scheda» da «chiunque scriva l'email di un altro entra nel suo organico». Senza conferma email la funzione smette di agganciare — rottura visibile, non un buco silenzioso — ma la protezione va lasciata dov'è.
- **Due inviti, due meccaniche diverse, apposta.** Il dipendente si registra da sé e l'account resta suo (è il suo profilo di carriera fra più aziende): l'email dice «registrati con questo indirizzo» e l'aggancio lo fa il trigger. Il collaboratore no: l'email porta un token monouso a `#/invito` sulla dashboard, e lì l'account **nasce** — `accept-invite` fa `createUser` con la password scelta in quel momento e `email_confirm: true`, poi `consume_invite` rende definitivo l'ingresso. Il canale lo sceglie il DB (`claim_invite_send`), non il client.
- ⚠️ **L'account del collaboratore non esiste prima che apra il link.** È il motivo per cui non lo crea `generateLink({ type: 'invite' })` all'invio (provato il 15/09, ritirato il 16): così l'indirizzo restava occupato anche per chi l'invito non lo apriva mai, e aprire il link attivava l'accesso **prima** della password. Non tornare a pre-creare l'account.
- ⚠️ **Il token non passa mai da chi invita**: lo genera la Edge Function, nel DB entra solo il suo SHA-256, e `claim_invite_send`/`peek_invite`/`consume_invite` sono **solo service role**. Se chi invita potesse sceglierlo, accetterebbe l'invito al posto del destinatario creando un account con l'email di un altro, già confermata.

## Dati (Supabase)
- Query/mutation nel data layer `src/features/*/api.ts` (`getX`/`saveX`/`createX`/`updateX`), **mai** fetch diretti nei componenti.
- Tipi da `src/types/database.ts`. Controllare sempre `error`. Le RLS filtrano per `auth.uid()`.
- Lo schema è una **baseline unica** in `supabase/migrations/` (le 99 storiche sono in `supabase/migrations_legacy/`, solo per consultazione). Banco di prova: `supabase/tests/run.sh up|reset|test` (Postgres in Docker) e `supabase/tests/gen-types.sh`.

## Convenzioni UI (vedi anche `.claude/skills/new-component`)
- Importare i componenti con `className` da **`@/tw`**, non da `react-native`. Comporre le classi con `cn()`.
- **Niente Tamagui.** `style`/`StyleSheet` solo per valori dinamici (eccezione: `Pill` usa `rgba` inline per il workaround color-mix).
- ⚠️ **Gotcha**: NON usare `<Link className=...>` da `@/tw` per testo tappabile (testo invisibile/non tappabile). Usare `Pressable` + `useRouter().push()` con `Text` stilizzato.
- Named export per le primitive; `export default` per le schermate Expo Router.
- Nessun `console.log` committato. Nessun `babel.config.js` (Tailwind v4 CSS-first; config in `metro.config.js`).

## Tooling Claude (`.claude/`)
- **Subagent**: `code-reviewer`, `principles-enforcer`, `techdebt-analyzer`.
- **Comandi**: `/full-review` (review parallela con i 3 subagent), `/pr` (pre-review + PR Conventional Commits).
- **Skill**: `new-component` (creare componenti/screen secondo le convenzioni), `improve` (audit read-only + piani per altri agent).
