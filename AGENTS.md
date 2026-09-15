# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

---

# topWaitr

Gestione dei turni per il settore dell'ospitalità (mercato italiano): ristoranti, hotel, catering, discoteche, pub e agenzie di eventi. Le **sedi** organizzano i turni con il proprio organico; i **professionisti** confermano i turni assegnati, tengono il conto delle ore e costruiscono la propria reputazione. Niente Stripe nel MVP.

> Il marketplace (professionisti che cercano turni e si candidano ad annunci) è stato rimosso dal codice il 2026-09-12. In DB restano inerti `applications`, l'enum `shift_kind` e i `notification_type` `application_*`: non vanno riesumati senza una decisione di prodotto.

⚠️ **Vocabolario**: nelle stringhe utente si usa **professionista** (non "cameriere") e **sede** (non "locale"/"ristorante"/"ristoratore"), perché il prodotto non è più solo per la ristorazione. I nomi interni restano `waiter`/`manager` (enum DB, rotte, tipi): non rinominarli.

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
- Pattern ufficiale Expo Router v56: `Stack.Protected` con 3 guard — `!session` → `(auth)`, `session && role==='manager'` → `(manager)`, `session && role==='waiter'` → `(waiter)`. Nessun `index.tsx` root.
- `AuthProvider`/`useAuth()` in `src/lib/auth.tsx`: `getSession()` + `onAuthStateChange` → `ensureProfile()` (select-or-insert in `profiles`, RLS `id=auth.uid()`). Ruolo letto da `user_metadata`. Nessun trigger su `auth.users`.
- ⚠️ **"Confirm email" su Supabase Auth non si disattiva.** L'aggancio automatico delle schede staff (`link_staff_invites_for_user`, 20260916100200) collega un account alla scheda che una sede ha preparato per quell'indirizzo. Il controllo `email_confirmed_at is not null` è l'unica cosa che separa «ti colleghiamo alla tua scheda» da «chiunque scriva l'email di un altro entra nel suo organico». Senza conferma email la funzione smette di agganciare — rottura visibile, non un buco silenzioso — ma la protezione va lasciata dov'è.

## Dati (Supabase)
- Query/mutation nel data layer `src/lib/*.ts` (`getX`/`saveX`/`createX`/`updateX`), **mai** fetch diretti nei componenti.
- Tipi da `src/types/database.ts`. Controllare sempre `error`. Le RLS filtrano per `auth.uid()`.

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
