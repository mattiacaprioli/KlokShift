/**
 * Versione in vigore della coppia termini + accordo sul trattamento dei dati.
 *
 * ⚠️ Gemello manuale di `private.current_legal_version()`
 * (`supabase/migrations/20261102000000_legal_acceptances.sql`): cambiano
 * insieme, e la pagina della versione vecchia resta pubblicata come
 * `dpa-vN.html`. Una modifica sostanziale si attiva solo dopo i 30 giorni di
 * preavviso ai titolari: è alzare la versione a far scattare il blocco.
 */
export const LEGAL_VERSION = "1";
