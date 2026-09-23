# KlokShift

KlokShift gestisce turni, organico, ore, assenze e comunicazioni per aziende con
personale a turni. Il repository contiene tre client dello stesso prodotto:

- `src/`: app iOS/Android in Expo SDK 56;
- `web/`: dashboard desktop Vite, pubblicata sotto `/app/`;
- `web-site/`: sito pubblico e pagine legali, pubblicati alla radice.

App e dashboard condividono il data layer in `src/features/` e usano lo stesso
progetto Supabase. Il sito pubblico non accede a Supabase.

## Requisiti e installazione

- Node.js 22.14.0 (la versione fissata in CI; Expo SDK 56 richiede almeno
  Node 20.19.x);
- Yarn Classic, con `yarn.lock` come lockfile del progetto;
- Docker soltanto per replay e test del database locale;
- Xcode o Android Studio per eseguire i client nativi.

```bash
yarn install --frozen-lockfile
```

Crea un `.env` nella root. Non commettere valori o credenziali:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_SITE_URL=
EXPO_PUBLIC_APP_URL=
EXPO_PUBLIC_IOS_URL=
EXPO_PUBLIC_ANDROID_URL=
EXPO_PUBLIC_SENTRY_DSN=
```

Le prime due variabili sono necessarie per app e dashboard. Le altre configurano
URL pubblici, badge degli store e Sentry; i fallback sono documentati in
`web-site/README.md`. Le variabili `EXPO_PUBLIC_*` finiscono nei bundle: non
inserire mai una service-role key.

## Avvio locale

```bash
yarn start       # Metro / Expo development server
yarn ios         # development build iOS
yarn android     # development build Android
yarn web         # app Expo renderizzata nel browser
yarn web:dev     # dashboard desktop Vite
yarn site:dev    # sito vetrina Vite
```

`yarn web` e `yarn web:dev` sono applicazioni diverse. Il progetto usa moduli
nativi e va provato con una development build quando Expo Go non li espone.

## Verifiche

```bash
yarn test:unit
yarn typecheck
yarn web:typecheck
yarn site:typecheck
yarn lint
yarn web:build
yarn site:build
CI=1 EXPO_OFFLINE=1 yarn expo export --platform ios --output-dir /tmp/klokshift-ios
```

Il gate CI esegue tutti questi controlli. Per il database locale sacrificabile:

```bash
supabase/tests/run.sh up
supabase/tests/run.sh reset
supabase/tests/run.sh test
supabase/tests/gen-types.sh
```

`reset` azzera soltanto il container Postgres di test gestito dallo script. Non
usarlo su un database condiviso o remoto. Dopo una migrazione, rigenera
`src/types/database.ts` e controlla il diff.

## Modello essenziale

`profiles` rappresenta l'account personale. L'azienda è un `workspace`; le sue
sedi sono `venues`. `workspace_members` descrive appartenenza, authority,
permessi e ambito aziendale, mentre `venue_members` descrive dove una persona
lavora ed è il bersaglio delle assegnazioni ai turni. Authority e organico sono
indipendenti; il profilo non contiene un ruolo.

Le scritture di dominio passano dalle RPC Supabase e gli accessi dai moduli
`src/features/*/api.ts`, non direttamente dai componenti. Per i vincoli completi
leggi, in quest'ordine:

- `AGENTS.md`: regole di prodotto e sviluppo correnti;
- `ARCHITECTURE.md`: struttura client e convenzioni del data layer;
- `supabase/README.md`: schema, RLS, migrazioni e banco di prova;
- `web/README.md` e `web-site/README.md`: dashboard e sito pubblico.

Le attività di consolidamento e le relative prove sono tracciate in
`plans/AUDIT-2026-09-22.md`.
