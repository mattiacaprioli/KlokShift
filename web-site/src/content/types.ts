/*
 * La forma del copy. Serve a due cose: fa fallire `site:typecheck` se una
 * traduzione futura dimentica un pezzo, e tiene i componenti liberi da
 * stringhe (nessuna frase concatenata, nessun testo nel markup).
 */

export type Link = { href: string; label: string };
export type Feature = { title: string; body: string };
export type Faq = { q: string; a: string };
export type BillingCycle = "monthly" | "annual";
export type BillingPrice = {
  amount: string;
  period: string;
  equivalent?: string;
  saving?: string;
};
export type Price = {
  name: string;
  monthly: BillingPrice;
  annual: BillingPrice;
  details: string[];
  badge?: string;
};

export type Content = {
  lang: string;

  brand: { name: string; tagline: string };

  nav: {
    menuLabel: string;
    closeLabel: string;
    links: Link[];
    cta: string;
  };

  hero: {
    title: string;
    lead: string;
    ctaPrimary: string;
    ctaSecondary: string;
    note: string;
    /** Descrizione della settimana animata, per chi non la vede. */
    boardLabel: string;
    /** L'avviso che compare quando l'ultima persona conferma. */
    toast: string;
  };

  /*
   * La storia che scende con chi legge: quattro passi in ordine, ognuno con il
   * suo «prima» in una riga. È la sezione «Come funziona» (`#come-funziona`).
   */
  story: {
    title: string;
    steps: { before: string; title: string; body: string }[];
  };

  /** Le altre funzioni, in righe brevi: niente card tutte uguali. */
  rest: {
    title: string;
    items: Feature[];
  };

  sectors: {
    title: string;
    items: string[];
  };

  plans: {
    title: string;
    lead: string;
    billing: {
      label: string;
      monthly: string;
      annual: string;
      annualBadge: string;
    };
    options: Price[];
    /** Oltre le fasce: riga sotto le schede, con il link all'email. */
    custom: { text: string; link: string; email: string };
    includedTitle: string;
    included: string[];
    extraVenue: Record<BillingCycle, string> & { detail: string };
    note: string;
    cta: string;
  };

  faq: {
    title: string;
    items: Faq[];
  };

  finalCta: {
    /** La settimana dell'apertura, ora tutta confermata, per chi non la vede. */
    boardLabel: string;
    title: string;
    lead: string;
    cta: string;
    secondary: string;
    note: string;
  };

  footer: {
    tagline: string;
    /** Titoli delle colonne in alto: le pagine del sito e il recapito. */
    productLabel: string;
    contactLabel: string;
    legalLabel: string;
    email: string;
    emailLabel: string;
    /** Le pagine legali: una riga piccola in fondo, accanto al copyright. */
    links: Link[];
    /** Chi vende e partita IVA: obbligatori nella home (art. 35 DPR 633/72). */
    owner: string;
    rights: string;
  };

  /*
   * La pagina d'atterraggio dell'email d'invito (`/invito/`). Non è una sezione
   * della landing: è un entry point a sé, e chi ci arriva ha già deciso — gli
   * manca solo l'app e l'avvertenza sull'indirizzo da usare.
   */
  invite: {
    eyebrow: string;
    title: string;
    lead: string;
    steps: Feature[];
    calloutTitle: string;
    calloutBody: string;
    storesSoon: string;
    iosLabel: string;
    androidLabel: string;
    whatTitle: string;
    whatItems: string[];
    homeLabel: string;
  };

  /*
   * Il ritorno dal link di conferma dell'email (`email-confermata.html`), per
   * chi si è registrato dall'app. Tre esiti: fatto, link scaduto o già usato,
   * altro errore.
   */
  emailConfirmed: {
    eyebrow: string;
    ok: { title: string; body: string };
    expired: { title: string; body: string };
    error: { title: string; body: string };
    openApp: string;
    otherDevice: string;
  };
};
