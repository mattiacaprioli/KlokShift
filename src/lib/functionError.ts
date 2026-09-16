/**
 * Il codice d'errore di una Edge Function, letto dal posto giusto.
 *
 * ⚠️ Su una risposta non-2xx `supabase.functions.invoke` restituisce
 * `data: null`: il corpo **non** è in `data`, sta dentro `error.context`, che è
 * la `Response` originale. Per mesi il data layer ha letto `data?.error`, cioè
 * sempre `undefined` — e così nessun codice veniva mai riconosciuto: una
 * function non deployata (`NOT_FOUND`) diventava «riprova tra qualche minuto»,
 * un rate limit pure, e un invito scaduto sulla pagina `#/invito` pure.
 *
 * Torna in un'unica stringa sia `error` (i nostri codici: `rate_limited`,
 * `invite_expired`…) sia `code` (quelli del gateway Supabase: `NOT_FOUND`),
 * così chi chiama può fare `includes()` senza sapere da quale dei due arriva.
 * Stringa vuota se il corpo non c'è o non è JSON.
 */
export async function functionErrorCode(error: unknown): Promise<string> {
  // Duck typing e non `instanceof FunctionsHttpError`: la dashboard web risolve
  // `@supabase/supabase-js` da un'altra cartella, e un `instanceof` fra due copie
  // della stessa classe è falso anche quando l'oggetto è quello giusto.
  const context = (error as { context?: unknown } | null)?.context;
  if (context && typeof (context as Response).clone === "function") {
    try {
      const body = (await (context as Response).clone().json()) as {
        error?: string;
        code?: string;
      } | null;
      return `${body?.error ?? ""} ${body?.code ?? ""}`.trim();
    } catch {
      // Corpo vuoto o non JSON: niente da riconoscere.
    }
  }
  return "";
}
