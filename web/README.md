# web — dashboard delle sedi

Interfaccia **desktop** per chi gestisce una sede: programmazione turni,
copertura, ore e export contabile. Il professionista non la usa: per lui l'app
mobile basta e avanza (chi apre questa dashboard con un account professionista
riceve una schermata di cortesia, non un errore).

Stesso backend Supabase dell'app, **stessa RLS, stessa anon key**: non esistono
policy dedicate al web. L'accesso del gestore deriva da `workspace_members`:
authority e permessi stabiliscono cosa può fare, mentre `member_scope` limita le
sedi su cui può farlo. `venues` non contiene un `owner_id`.

## Comandi (dalla root del repo)

```bash
yarn web:dev         # dev server Vite
yarn web:build       # build di produzione → web/dist
yarn web:typecheck   # tsc con il tsconfig del web
yarn lint            # eslint su src/ E web/src/ (i path sono nominati nello
                     #   script: `expo lint` da solo guarda solo src/app/components)
```

⚠️ Da non confondere con `yarn web`, che è `expo start --web` (l'app mobile
renderizzata nel browser) — un'altra cosa.

## Perché non c'è un `package.json` qui

Le dipendenze web stanno nel `package.json` della **root**, come devDependencies.

Non è pigrizia: `web/` importa `../src/features/**`, che a sua volta importa
`@tanstack/react-query` e `@supabase/supabase-js`. Con una `node_modules` locale,
la risoluzione Node risalirebbe da `src/` e prenderebbe le copie di root, mentre
`web/src/**` prenderebbe le proprie → **due istanze di React Query e context
rotto**. Con una sola `node_modules` il problema non si pone. In
`vite.config.mts` c'è comunque un `resolve.dedupe` come cintura di sicurezza.

## Come funziona il riuso del data layer

La dashboard riusa il data layer in `src/features/`; gli adattatori dipendenti
dalla piattaforma sono sostituiti da alias in `vite.config.mts`:

| Alias | Sostituito con | Perché |
|---|---|---|
| `@/lib/supabase` | `web/src/lib/supabase.ts` | niente SecureStore: su web basta localStorage |
| `@/features/push/api` | `web/src/lib/pushStub.ts` | è l'unico import che rende `src/lib/auth.tsx` non portabile |
| `@/features/venues/lastVenueStorage` | `web/src/lib/lastVenueStorage.ts` | usa localStorage invece di SecureStore |

Con questi alias si riusano **verbatim** `AuthProvider`/`useAuth`, `queryClient`,
la factory `qk`, `format`, `cn`, ogni `api.ts`/`hooks.ts`/`schema.ts`,
`assignments/{hours,coverage}.ts`, `staff/roles.ts`, `lib/exportBuilders.ts` e
`RealtimeSync`. Qui dentro si scrive **solo UI**.

Regola conseguente: **niente `.from(` nei componenti web**. Ogni accesso ai dati
passa dai `features/*/api.ts`, come impone `ARCHITECTURE.md`, e ogni chiave di
query viene dalla factory `qk` — altrimenti le invalidazioni divergono tra i due
client.

## Variabili d'ambiente

Vite legge il **`.env` della root** con gli stessi nomi dell'app (`envDir` +
`envPrefix` in `vite.config.mts`): `EXPO_PUBLIC_SUPABASE_URL` e
`EXPO_PUBLIC_SUPABASE_ANON_KEY`. Una sola configurazione Supabase, nessuna
coppia `VITE_*` da tenere allineata.

## Deploy

Il job `client` di `.github/workflows/ci.yml` costruisce un unico artifact Pages:
`web-site/dist` alla radice, `web/dist` sotto `/app/` e la superficie sospesa
`web-review/` sotto `/recensioni/`. Il deploy riusabile parte soltanto dopo i
gate client, database ed Edge Function dello stesso SHA.

Per questo il router è un **HashRouter**: Pages non fa fallback SPA. Quando la
dashboard avrà un dominio proprio si passa a `BrowserRouter`.

## Scelte da conoscere prima di metterci mano

- **La registrazione dal web suggerisce l'intento di gestione**: non crea un
  ruolo sul profilo. L'account si crea con `signUp` condiviso di
  `src/lib/auth.tsx`; dopo la conferma, il gate di `AppLayout` porta alla
  creazione dell'azienda e della prima sede. La vista effettiva deriva poi da
  `get_my_context()` e dalle appartenenze.
  ⚠️ Il link di conferma punta all'URL della dashboard (`emailRedirectTo`): va
  aggiunto ai **Redirect URLs** del progetto Supabase, altrimenti si ripiega sul
  Site URL. Il client web ha `detectSessionInUrl: false` (i token nel fragment
  litigherebbero con l'`HashRouter`), quindi dopo la conferma si passa dal
  login: il catch-all fuori sessione ci porta da sé.
- **Il recupero password si chiude qui, nel browser.** `Login` chiede l'email
  con `resetPassword(email, redirectTo)`; il link torna sulla dashboard con i
  token nel fragment, `web/src/lib/recovery.ts` li consuma **prima del mount**
  (dopo, il primo `<Navigate>` dell'`HashRouter` li cancellerebbe) e porta a
  `/nuova-password`, che sta davanti a ogni gate di `<App />`.
  ⚠️ Anche qui l'URL della dashboard va nei **Redirect URLs** di Supabase,
  altrimenti il link ripiega sul Site URL — che porta all'app, cioè fuori dal
  desktop da cui si è partiti. Link scaduto → `#/login?link=scaduto`, e
  l'accesso lo dice invece di restare muto.
- **Un errore di render non è una pagina bianca**: `AppErrorBoundary`
  (`web/src/ui/ErrorBoundary.tsx`) è l'equivalente dell'`ErrorBoundary` in
  `src/providers/AppProviders.tsx` e si azzera al cambio di rotta. La
  segnalazione passa da `web/src/lib/reportError.ts`, che oggi scrive solo in
  console: `@sentry/react-native` non sta in un bundle Vite, quando la dashboard
  avrà un DSN proprio lì dentro va `@sentry/react`.
- **La foto profilo si carica da qui** (Impostazioni → Account) e, dalla stessa
  base, anche dall'app. Bucket pubblico `avatars`, una cartella per utente
  (migration 20260911130000); il ritaglio quadrato e il ridimensionamento a 512
  px li fa il browser prima di caricare (`web/src/lib/avatarFile.ts`), e ogni
  caricamento usa un nome nuovo perché con l'URL identico la CDN continuerebbe
  a servire la foto vecchia. Le funzioni stanno in `src/features/account/api.ts`
  e `uploadAvatar` prende i byte (`Blob` dal web, `ArrayBuffer` dall'app), non un
  percorso: su React Native un `Blob` costruito con `fetch(uri)` caricherebbe
  zero byte.
- **Il drag & drop del Planning è nativo del browser**, nessuna libreria
  (`web/src/shifts/dragContext.tsx`): il browser dà autoscroll, immagine
  trascinata e — cosa che qui conta — nessun `click` dopo un trascinamento
  riuscito, visto che ogni sorgente è già un `<button>` che apre il pannello.
  Settimana e mese spostano la data; la vista per persona riassegna, e accetta
  solo dalla **stessa colonna** (un altro giorno *di un'altra persona* sarebbe
  spostamento e riassegnazione insieme). Resta una scorciatoia: tutto si fa
  anche dal pannello, quindi il touch che il drag nativo non copre non toglie
  niente a nessuno.
  ⚠️ Spostare un turno **manda una notifica** a chi è assegnato e ai candidati
  accettati (`notify_on_shift_change`): per questo si chiede conferma con il
  numero vero. Il conteggio sta in `src/features/shifts/notify.ts` ed è un
  gemello del trigger — se cambia il trigger, va cambiato anche lui.
- **La presenza si modifica dal pannello del turno**, non dalla pagina Ore: è lì
  che i dati vivono già (`useShiftAssignments`). La pagina Ore aggrega per
  persona sul mese e non conosce le singole assegnazioni.
- **`web/src/shifts/schema.ts` non riusa `shiftSchema`** dell'app: quello è
  modellato sui picker RN e usa oggetti `Date`, mentre gli input nativi del
  browser danno già stringhe nel formato delle colonne DB. L'invariante che
  conta (fine dopo inizio) è la stessa, con lo stesso messaggio.
- **`positions_filled` non si scrive mai dal client**: lo tengono i trigger DB.
- Vocabolario delle stringhe utente: **professionista** e **sede**, mai
  "cameriere"/"ristoratore" (vedi `AGENTS.md`). Gli identificatori interni
  restano `waiter`/`manager`.
