# Architettura KlokShift

Gestione dei turni per l'ospitalità (Expo SDK 56 · React Native 0.85 · Expo
Router · Supabase · NativeWind v4/Tailwind v4). Questo documento è la guida di
riferimento per come è organizzato il codice e come si aggiunge una feature.

## Struttura

```
src/
  app/            # SOLO routing (Expo Router). Schermate sottili: chiamano hook di feature.
  components/
    ui/           # design-system primitives (GoldButton, Input, Mono, Display, Icon, …)
    form/         # wrapper RHF: ControlledInput, ControlledPicker
  features/       # logica di dominio, una cartella per dominio
    <feature>/
      api.ts      # funzioni Supabase pure (query/mutation), niente React
      hooks.ts    # hook TanStack Query/Mutation che avvolgono api.ts
      schema.ts   # schemi Zod + tipi inferiti dei form
      types.ts    # tipi derivati dal DB specifici della feature (opzionale)
  lib/            # infrastruttura cross-cutting: supabase, auth, queryClient, queryKeys, cn, format
  providers/      # AppProviders (composizione), Toast, ErrorFallback
  types/          # database.ts GENERATO (vedi supabase/README.md)
```

Regola: **le schermate non parlano mai direttamente con Supabase.** Importano gli
hook di feature. Le funzioni grezze stanno in `features/*/api.ts`.

## Data layer — TanStack Query

- Client e default in [src/lib/queryClient.ts](src/lib/queryClient.ts).
- **Tutte** le query key passano dalla factory [src/lib/queryKeys.ts](src/lib/queryKeys.ts)
  (`qk.venues.mine(id)`, `qk.shifts.byVenue(id)`, `qk.shifts.detail(id)`,
  `qk.assignments.byShift(id)`). Così l'invalidazione resta coerente.
- Le **query** usano `useQuery`; le **mutation** `useMutation` con
  `onSuccess → queryClient.invalidateQueries(...)` (niente più `useFocusEffect`+`load()`).
- Feedback utente: `onError`/`onSuccess` → `useToast()` ([src/providers/Toast.tsx](src/providers/Toast.tsx)).
- Esempio di riferimento: assegnazioni in
  [src/features/assignments/hooks.ts](src/features/assignments/hooks.ts)
  (`useRespondToAssignment` e `useSetAssignmentPresence` aggiornano lo stato e
  invalidano assegnazioni + dettaglio turno).

## Form — react-hook-form + Zod

- Schema in `features/<feature>/schema.ts`; tipo del form = `z.infer<typeof schema>`.
- `useForm({ resolver: zodResolver(schema), defaultValues })` + campi
  [ControlledInput](src/components/form/ControlledInput.tsx) /
  [ControlledPicker](src/components/form/ControlledPicker.tsx).
- Gli errori di validazione compaiono sotto il campo; gli errori API si mostrano
  via toast o testo inline.
- Convenzione: niente `.default()` negli schemi (i default stanno in
  `defaultValues`), così input e output dello schema coincidono ed evitano attriti
  di tipo con `zodResolver`.

## Provider & affidabilità

- [src/providers/AppProviders.tsx](src/providers/AppProviders.tsx) compone:
  `SafeAreaProvider > QueryClientProvider > AuthProvider > ToastProvider >
  ErrorBoundary`. È montato una sola volta nel root layout.
- `ErrorBoundary` mostra un fallback recuperabile e inoltra a Sentry.
- Auth: vedi [src/lib/auth.tsx](src/lib/auth.tsx) e la nota sul deadlock di
  `onAuthStateChange` (mai `await` di query Supabase dentro quel callback).

## Ops

- **Supabase as code**: `supabase/` + script `yarn db:pull` / `yarn db:types`
  (vedi [supabase/README.md](supabase/README.md)). I tipi in `src/types/database.ts`
  sono **generati**, non più a mano.
- **CI**: [.github/workflows/ci.yml](.github/workflows/ci.yml) — `tsc --noEmit`
  (+ lint quando ESLint sarà configurato).
- **Build**: [eas.json](eas.json) — profili development/preview/production.
- **Crash reporting**: Sentry, no-op finché non viene impostato
  `EXPO_PUBLIC_SENTRY_DSN`.

## Aggiungere una feature (slice verticale)

Pianifica per **slice verticali** (una funzione utente end-to-end), non orizzontali
("tutte le UI"). Esempio — "assegnare un turno allo staff":

1. `features/assignments/api.ts` → `createInternalShift(...)`
2. `features/assignments/hooks.ts` → `useCreateInternalShift()` (mutation + invalidazione)
3. `web/src/shifts/schema.ts` (o il form dell'app) → schema del turno
4. schermata in `app/(manager)/...` che usa l'hook
5. RLS lato Supabase (policy) verificata

### Definition of Done (per ogni slice)

- [ ] `yarn typecheck` pulito
- [ ] `npx expo export --platform ios` builda senza errori
- [ ] Stati **loading / error / empty** gestiti via TanStack Query
- [ ] Mutation con feedback toast e invalidazione delle query giuste
- [ ] RLS verificata sul DB (l'azione funziona con `auth.uid()` del ruolo giusto)
- [ ] Provato a schermo sul simulatore/dispositivo
