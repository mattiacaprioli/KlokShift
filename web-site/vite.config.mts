import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

export default defineConfig(({ mode }) => ({
  root: here,
  // Percorsi relativi come in `web/`: il sito gira alla radice di Pages oggi e
  // sotto un dominio proprio domani, senza ricompilare con una `base` diversa.
  base: "./",
  // Stesso `.env` della root dell'app: una sola configurazione.
  envDir: repoRoot,
  envPrefix: ["EXPO_PUBLIC_"],
  // Il codice qui legge `process.env.EXPO_PUBLIC_*` come il resto del progetto
  // (convenzione Expo), che nel browser non esiste: si sostituisce a build-time.
  define: {
    // Le chiavi assenti dal `.env` non verrebbero sostituite affatto e
    // `process` non esiste nel browser: quelle che il codice legge davvero
    // hanno quindi un default dichiarato qui.
    "process.env.EXPO_PUBLIC_APP_URL": JSON.stringify(""),
    "process.env.EXPO_PUBLIC_IOS_URL": JSON.stringify(""),
    "process.env.EXPO_PUBLIC_ANDROID_URL": JSON.stringify(""),
    ...Object.fromEntries(
      Object.entries(loadEnv(mode, repoRoot, "EXPO_PUBLIC_")).map(([k, v]) => [
        `process.env.${k}`,
        JSON.stringify(v),
      ])
    ),
  },
  plugins: [react(), tailwindcss()],
  // Nessun alias verso `../src/`: la vetrina non tocca Supabase né il data
  // layer. È una pagina statica, e l'unica cosa che condivide col prodotto
  // sono i token di design (copiati in `src/index.css`).
  build: {
    outDir: resolve(here, "dist"),
    emptyOutDir: true,
    // Due pagine, non una SPA: `invito.html` è l'atterraggio dell'email
    // d'invito, e Pages non fa fallback SPA — deve essere un file vero.
    // Sta alla radice e non in `invito/index.html` di proposito: con
    // `base: "./"` un entry annidato cambierebbe la profondità dei path
    // relativi, e gli `./privacy.html` del footer punterebbero dentro la
    // sottocartella.
    rollupOptions: {
      input: {
        main: resolve(here, "index.html"),
        invito: resolve(here, "invito.html"),
      },
    },
  },
}));
