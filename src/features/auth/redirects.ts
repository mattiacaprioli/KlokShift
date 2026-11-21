import { DEFAULT_SITE_URL } from "@/features/account/legal";

/**
 * Dove atterrano i link delle email di Auth mandate **dall'app**.
 *
 * Senza un redirect esplicito Supabase usa il Site URL del progetto, che è la
 * dashboard delle sedi (`/app/`): giusto per chi gestisce, sbagliato per un
 * dipendente al telefono.
 *
 * ⚠️ Entrambi gli URL vanno nei Redirect URLs di Supabase Auth
 * (Authentication → URL Configuration). Un URL fuori elenco non dà errore:
 * Supabase ripiega in silenzio sul Site URL.
 */
const SITE = (process.env.EXPO_PUBLIC_SITE_URL?.trim() || DEFAULT_SITE_URL).replace(/\/+$/, "");

/**
 * Recupero password: la dashboard, l'unico posto con la pagina dove si sceglie
 * la nuova password. Stesso indirizzo che la dashboard manda per sé.
 */
export const RECOVERY_REDIRECT_URL = `${SITE}/app/`;

/**
 * Conferma dell'email: la pagina del sito che dice «fatto» e rimanda all'app
 * (`web-site/src/sections/EmailConfirmedPage.tsx`).
 */
export const CONFIRM_REDIRECT_URL = `${SITE}/email-confermata.html`;
