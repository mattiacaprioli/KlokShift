// Configurazione Supabase della dashboard web in CI (audit B01).
//
// Vite scrive URL e key DENTRO il bundle al momento della build: impostarle
// nel job di deploy non serve, l'artifact è già fatto. Per questo la scelta
// avviene qui, prima della build, e il bundle viene ricontrollato dopo.
//
// - PR e branch: valori sintetici, nessun contatto con produzione.
// - Rilascio (push/dispatch su main): valori reali dalle variabili GitHub,
//   validati; se mancano o sono i placeholder il job fallisce e Pages non parte.
//
// La key non viene mai stampata, nemmeno negli errori.
//
//   node scripts/release-config.mjs select
//   node scripts/release-config.mjs check-bundle web/dist

import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const CI_SUPABASE_URL = "https://example.supabase.co";
export const CI_SUPABASE_ANON_KEY = "public-ci-key";

const PLACEHOLDERS = [CI_SUPABASE_URL, "example.supabase.co", CI_SUPABASE_ANON_KEY];
const SUPABASE_URL = /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/;

/** Ruolo dichiarato da una key JWT di Supabase, o null se non è un JWT. */
function jwtRole(key) {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.role === "string" ? payload.role : "";
  } catch {
    return null;
  }
}

function assertPublicKey(key) {
  if (key.startsWith("sb_secret_")) {
    throw new Error("La key di rilascio è una secret key: nel bundle va solo la key pubblica (anon/publishable).");
  }
  if (key.startsWith("sb_publishable_")) return;
  const role = jwtRole(key);
  if (role === "service_role") {
    throw new Error("La key di rilascio è la service role: nel bundle va solo la key pubblica (anon/publishable).");
  }
  if (role !== "anon") {
    throw new Error("La key di rilascio non è una key pubblica Supabase riconosciuta (JWT anon o sb_publishable_).");
  }
}

/**
 * Sceglie la configurazione Supabase con cui compilare.
 * @param {{ release: boolean, url?: string, key?: string }} input
 * @returns {{ url: string, key: string }}
 */
export function selectSupabaseConfig({ release, url, key }) {
  if (!release) return { url: CI_SUPABASE_URL, key: CI_SUPABASE_ANON_KEY };

  const realUrl = (url ?? "").trim();
  const realKey = (key ?? "").trim();
  if (!realUrl || !realKey) {
    throw new Error(
      "Rilascio senza configurazione Supabase: definisci le variabili GitHub EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY."
    );
  }
  if (PLACEHOLDERS.some((p) => realUrl.includes(p) || realKey === p)) {
    throw new Error("Rilascio con i valori fittizi della CI: serve la configurazione Supabase reale.");
  }
  if (!SUPABASE_URL.test(realUrl)) {
    throw new Error(`URL Supabase di rilascio non valido: atteso https://<ref>.supabase.co, trovato ${realUrl}.`);
  }
  assertPublicKey(realKey);
  return { url: realUrl.replace(/\/$/, ""), key: realKey };
}

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".js"))
    .map((e) => join(e.parentPath, e.name));
}

/**
 * Verifica che il bundle compilato punti al backend atteso.
 * @param {{ dir: string, expectedHost: string }} input
 */
export function checkBundle({ dir, expectedHost }) {
  const files = jsFiles(dir);
  if (files.length === 0) throw new Error(`Nessun file JS in ${dir}: la build non è stata eseguita?`);

  const code = files.map((f) => readFileSync(f, "utf8")).join("\n");
  const found = PLACEHOLDERS.filter((p) => code.includes(p));
  if (found.length > 0) {
    throw new Error(`Il bundle contiene i valori fittizi della CI (${found.join(", ")}): non è pubblicabile.`);
  }
  if (!code.includes(expectedHost)) {
    throw new Error(`Il bundle non contiene l'host Supabase atteso (${expectedHost}).`);
  }
}

function main(argv, env) {
  const [command, dir] = argv;
  if (command === "select") {
    const release = env.KS_RELEASE === "true";
    const { url, key } = selectSupabaseConfig({
      release,
      url: env.RELEASE_SUPABASE_URL,
      key: env.RELEASE_SUPABASE_ANON_KEY,
    });
    if (!env.GITHUB_ENV) throw new Error("GITHUB_ENV non definita: il comando select gira solo in GitHub Actions.");
    appendFileSync(env.GITHUB_ENV, `EXPO_PUBLIC_SUPABASE_URL=${url}\nEXPO_PUBLIC_SUPABASE_ANON_KEY=${key}\n`);
    console.log(`Supabase ${release ? "di rilascio" : "fittizio (verifica)"}: ${new URL(url).host}`);
    return;
  }
  if (command === "check-bundle") {
    if (!dir) throw new Error("Uso: check-bundle <cartella-dist>");
    const expectedHost = new URL(selectSupabaseConfig({
      release: true,
      url: env.EXPO_PUBLIC_SUPABASE_URL,
      key: env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    }).url).host;
    checkBundle({ dir, expectedHost });
    console.log(`Bundle verificato: punta a ${expectedHost}.`);
    return;
  }
  throw new Error("Uso: release-config.mjs select | check-bundle <cartella-dist>");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
