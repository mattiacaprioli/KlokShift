---
name: new-component
description: Crea un nuovo componente UI o una nuova schermata Expo Router in KlokShift seguendo le convenzioni del progetto. Attiva quando si aggiunge un file in src/components/, src/app/, si crea un hook, o si struttura una nuova feature.
---

# Nuovo componente / schermata — KlokShift

Stack: Expo SDK 56 + React Native 0.85 + Expo Router + Supabase + NativeWind v5 (wrapper `@/tw`).
Linea guida: React Native puro + NativeWind. Niente Tamagui, niente GraphQL/Relay.

## Dove va il file

| Tipo | Posizione |
|------|-----------|
| Primitiva UI riusabile | `src/components/ui/PascalCase.tsx` |
| Schermata | `src/app/(auth\|waiter\|manager)/nome.tsx` (routing file-based) |
| Route dinamica | `src/app/(manager)/shift/[id].tsx` |
| Data layer (Supabase) | `src/lib/*.ts` (funzioni `getX`/`saveX`/`createX`/`updateX`) |
| Tipi DB | `src/types/database.ts` (generati) |
| Util / format | `src/lib/format.ts`, `src/lib/cn.ts` |

## Naming
- Componenti e schermate-componente: `PascalCase.tsx`, **named export** (`export function Nome`), non `export default` per le primitive.
- Le schermate Expo Router invece usano `export default`.
- Hook: `useCamelCase.ts`.

## Styling — NativeWind via wrapper `@/tw` (SEMPRE)

Importa i componenti dal wrapper `@/tw`, **non** da `react-native`, così il `className` funziona:

```tsx
import { View, Text, Pressable } from "@/tw";
import { cn } from "@/lib/cn";

export function Esempio({ className }: { className?: string }) {
  return (
    <View className={cn("items-center px-6 py-4", className)}>
      <Text className="text-base font-semibold text-t1">Titolo</Text>
      <Text className="mt-1 text-sm text-t3">Sottotitolo</Text>
    </View>
  );
}
```

- Usa i token del design system (es. `text-t1`, `text-t3`, palette AURA) definiti in `src/global.css` / `src/constants/theme.ts`.
- `StyleSheet`/`style` inline solo per valori veramente dinamici (animazioni). Il `Pill` usa `rgba` inline di proposito (workaround color-mix di react-native-css).

## ⚠️ Gotcha critico — link tappabili

NON usare `<Link className=...>` da `@/tw` per testo tappabile: il `className` non applica colore/font in modo affidabile (testo invisibile dark-su-dark) e il tap non funziona. Usa invece `Pressable` + `useRouter()`:

```tsx
import { Pressable, Text } from "@/tw";
import { useRouter } from "expo-router";

const router = useRouter();
<Pressable onPress={() => router.push("/(auth)/signup")}>
  <Text className="text-sm font-semibold text-gold">Registrati</Text>
</Pressable>
```

## Dati — Supabase tramite data layer (mai fetch diretti nei componenti)

Le query/mutation vivono in `src/lib/*.ts` (es. `src/lib/manager.ts`), non nei componenti. Pattern:

```ts
// src/lib/manager.ts
export async function getMyShifts(): Promise<ShiftWithCount[]> {
  const { data, error } = await supabase
    .from("shifts")
    .select("*, applications(count)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
```

Nel componente: caricamento con `useFocusEffect` + `RefreshControl`, stato locale, gestione errore. Tipi importati da `src/types/database.ts`. Le RLS Supabase filtrano per `auth.uid()` — non aggiungere filtri owner lato client se la policy già li copre.

## Primitive esistenti da riusare (non reinventare)

`GoldButton`, `GhostButton`, `BlurCard`, `Card`, `Avatar`, `Pill`, `Chip`, `Input`, `SectionHeader`, `EmptyState`, `ShimmerText`, `Icon`, `Logo`, `LogoBadge`, `Mono`, `Display` — tutte in `src/components/ui/`.

## Form & date
- Form: `TextInput` (via `Input`) + stato locale / handler. Nessuna lib form esterna nel MVP.
- Date/time: `@react-native-community/datetimepicker` (vedi `PickerField` in `src/app/(manager)/shift/new.tsx`). Conversione Date↔stringa DB con `toDateString`/`toTimeString` in `src/lib/format.ts`.

## Testo & lingua
Tutte le stringhe utente sono in **italiano inline** (nessuna lib i18n nel MVP).

## Checklist
- [ ] File nella cartella giusta (`src/components/ui/` o `src/app/<gruppo>/`)
- [ ] Import da `@/tw` (non da `react-native`) per componenti con `className`
- [ ] `cn()` per comporre className con props `className`
- [ ] Link tappabili con `Pressable` + `useRouter()`, mai `<Link className>`
- [ ] Accesso dati via funzioni in `src/lib/`, tipi da `src/types/database.ts`
- [ ] Riusate le primitive esistenti dove possibile
- [ ] Stringhe utente in italiano
- [ ] Nessun `console.log` committato
