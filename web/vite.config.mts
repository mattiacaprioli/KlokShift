import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

export default defineConfig(({ mode }) => ({
  root: here,
  // Percorsi relativi: la SPA gira sotto /topWaitr/app/ su GitHub Pages oggi e
  // sulla radice di un dominio proprio domani, senza ricompilare con base diverse.
  base: "./",
  // Riusa il .env della root con gli stessi nomi dell'app: una sola fonte per
  // URL e anon key di Supabase, nessuna coppia VITE_* da tenere allineata.
  envDir: repoRoot,
  envPrefix: ["VITE_", "EXPO_PUBLIC_"],
  // Il codice condiviso legge le env come `process.env.EXPO_PUBLIC_*` (è la
  // convenzione di Expo), che nel browser non esiste. Invece di toccare quei
  // file, si sostituiscono a build-time: così qualunque file di `src/` che usi
  // una EXPO_PUBLIC_* funziona qui senza modifiche.
  define: Object.fromEntries(
    Object.entries(loadEnv(mode, repoRoot, "EXPO_PUBLIC_")).map(([k, v]) => [
      `process.env.${k}`,
      JSON.stringify(v),
    ])
  ),
  plugins: [react(), tailwindcss()],
  resolve: {
    // L'ORDINE CONTA: i pattern esatti devono precedere il wildcard "@/".
    alias: [
      // Il client mobile usa SecureStore (nativo). Su web basta il localStorage
      // di default di supabase-js. Il tipo esportato è identico.
      {
        find: "@/lib/supabase",
        replacement: resolve(here, "src/lib/supabase.ts"),
      },
      // Unico import che rende `src/lib/auth.tsx` non portabile: neutralizzandolo
      // AuthProvider/useAuth/ensureProfile si riusano verbatim.
      {
        find: "@/features/push/api",
        replacement: resolve(here, "src/lib/pushStub.ts"),
      },
      // Quale sede il titolare stava guardando: SecureStore sul telefono,
      // localStorage qui. Stessa firma, così `ActiveVenueProvider` si riusa
      // verbatim.
      {
        find: "@/features/venues/activeVenueStorage",
        replacement: resolve(here, "src/lib/activeVenueStorage.ts"),
      },
      { find: /^@\//, replacement: `${repoRoot}/src/` },
    ],
    // Cintura di sicurezza: `../src/**` risolverebbe questi pacchetti risalendo
    // da src/, e una seconda copia di React Query romperebbe il context.
    dedupe: [
      "react",
      "react-dom",
      "@tanstack/react-query",
      "@supabase/supabase-js",
    ],
  },
  server: {
    // Il codice condiviso sta fuori da `root`.
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: resolve(here, "dist"),
    emptyOutDir: true,
  },
}));
