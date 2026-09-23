/**
 * Pagine legali pubbliche. Stanno alla radice del sito vetrina (`web-site/`,
 * su GitHub Pages) con i nomi di file di sempre: gli stessi indirizzi sono
 * dichiarati nelle schede degli store — Play Console chiede sia l'URL
 * dell'informativa sia quello per la richiesta di cancellazione account — e
 * non devono cambiare quando cambia il resto del sito.
 *
 * La base URL arriva da `EXPO_PUBLIC_SITE_URL`. Il dominio pubblico è anche il
 * fallback intenzionale: un'app distribuita non deve mai aprire localhost né
 * tornare al vecchio sito delle recensioni quando una build omette la env.
 */
export const DEFAULT_SITE_URL = "https://klokshift.com";

export function legalUrlsFor(siteUrl?: string) {
  const baseUrl = (siteUrl?.trim() || DEFAULT_SITE_URL).replace(/\/+$/, "");

  return {
    privacy: `${baseUrl}/privacy.html`,
    accountDeletion: `${baseUrl}/elimina-account.html`,
  } as const;
}

export const LEGAL_URLS = legalUrlsFor(process.env.EXPO_PUBLIC_SITE_URL);
