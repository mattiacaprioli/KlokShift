/*
 * La forma del copy. Serve a due cose: fa fallire `site:typecheck` se una
 * traduzione futura dimentica un pezzo, e tiene i componenti liberi da
 * stringhe (nessuna frase concatenata, nessun testo nel markup).
 */

export type Link = { href: string; label: string };
export type Feature = { title: string; body: string };
export type Faq = { q: string; a: string };
/** Una riga del «prima e dopo»: il problema di oggi e come lo risolve KlokShift. */
export type BeforeAfter = Feature & { after: string };
export type Price = {
  name: string;
  price: string;
  period: string;
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
    eyebrow: string;
    title: string;
    lead: string;
    ctaPrimary: string;
    ctaSecondary: string;
    note: string;
    shotAlt: string;
  };

  problem: {
    eyebrow: string;
    title: string;
    lead: string;
    items: BeforeAfter[];
  };

  venue: {
    eyebrow: string;
    title: string;
    lead: string;
    features: Feature[];
    shotPlanningAlt: string;
    shotHoursAlt: string;
  };

  pro: {
    eyebrow: string;
    title: string;
    lead: string;
    features: Feature[];
    shotAlt: string;
  };

  how: {
    eyebrow: string;
    title: string;
    steps: Feature[];
  };

  sectors: {
    eyebrow: string;
    title: string;
    lead: string;
    items: string[];
  };

  platforms: {
    eyebrow: string;
    title: string;
    items: Feature[];
  };

  plans: {
    eyebrow: string;
    title: string;
    lead: string;
    options: Price[];
    includedTitle: string;
    included: string[];
    extraVenue: string;
    note: string;
    cta: string;
  };

  faq: {
    eyebrow: string;
    title: string;
    items: Faq[];
  };

  finalCta: {
    title: string;
    lead: string;
    cta: string;
    secondary: string;
    note: string;
  };

  footer: {
    tagline: string;
    email: string;
    emailLabel: string;
    links: Link[];
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
  /**
   * La stessa pagina, per chi è stato invitato a **gestire** una sede e non a
   * lavorarci (`invito.html?r=gestione`). Cambia l'unica frase che conta: deve
   * registrarsi come sede, non come professionista.
   */
  inviteManager: {
    eyebrow: string;
    title: string;
    lead: string;
    steps: Feature[];
    calloutTitle: string;
    calloutBody: string;
    webTitle: string;
    webBody: string;
    webLabel: string;
    whatTitle: string;
    whatItems: string[];
  };
};
