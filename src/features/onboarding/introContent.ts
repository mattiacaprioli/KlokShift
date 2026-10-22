import type { IconName } from "@/components/ui/Icon";
import type { ViewMode } from "@/features/team/viewModeStorage";

/** La vista attiva: `waiter` = lavoro, `manager` = gestione. */
type Role = ViewMode;

export type IntroSlide = {
  icon: IconName;
  title: string;
  body: string;
};

// ⚠️ MANUTENZIONE — LEGGERE PRIMA DI TOCCARE LE FEATURE
// Questo è il testo mostrato UNA VOLTA ai nuovi utenti al primo avvio.
// È l'unica fonte della copy del carosello: se cambi/aggiungi/togli una feature,
// o il percorso di avvio (prima sede → prova → ruoli → persone → turno, vedi
// `firstSteps.ts`), AGGIORNA queste slide, altrimenti l'onboarding racconta
// un'app che non esiste più. Niente prezzi né acquisti: le legge l'app nativa.

/**
 * Tre serie, una per chi arriva: il titolare (o chi sta per diventarlo), il
 * collaboratore che lavora su ciò che gli hanno affidato, e chi lavora in turno.
 * Il collaboratore aveva le slide del titolare e gli promettevano cose che non
 * poteva fare.
 */
export type IntroAudience = "owner" | "collaborator" | "worker";

export const INTRO_SLIDES: Record<IntroAudience, IntroSlide[]> = {
  owner: [
    {
      icon: "home",
      title: "Apri la tua sede in un minuto",
      body: "Ti serve solo il nome. Indirizzo e dettagli li aggiungi quando vuoi.",
    },
    {
      icon: "sparkle",
      title: "30 giorni di prova, li avvii tu",
      body: "Senza carta. Poi aggiungi ruoli e persone e crei i turni: la Home ti guida passo per passo.",
    },
    {
      icon: "users",
      title: "Il team entra con la sua email",
      body: "Aggiungi le persone con la loro email: si registrano all'app con quella, trovano i turni e li confermano con un tocco.",
    },
  ],
  collaborator: [
    {
      icon: "shield",
      title: "Gestisci quello che ti hanno affidato",
      body: "Il titolare ha scelto cosa puoi fare: turni, organico, ore o dati della sede.",
    },
    {
      icon: "calendar",
      title: "Le tue sedi, tutte qui",
      body: "Turni, persone e messaggi delle sedi che segui, dal telefono o dalla dashboard web.",
    },
    {
      icon: "lock",
      title: "Il resto lo decide il titolare",
      body: "Piano dell'azienda, nuove sedi e collaboratori restano a lui.",
    },
  ],
  worker: [
    {
      icon: "users",
      title: "La sede ti aggiunge con la tua email",
      body: "La stessa con cui ti sei registrato: la tua sede e i tuoi turni compaiono da soli, senza codici.",
    },
    {
      icon: "calendar",
      title: "Conferma i turni con un tocco",
      body: "Ti arriva una notifica quando ti assegnano un turno o cambia qualcosa, e rispondi da qui.",
    },
    {
      icon: "clock",
      title: "Timbra e ritrova le tue ore",
      body: "Entrata, pausa e uscita dall'app, se la tua sede la usa. Le ore lavorate sono nel tuo profilo.",
    },
  ],
};

/** Quale serie: la vista attiva, e in gestione l'authority nell'azienda corrente. */
export function introAudience(
  view: Role,
  authority: "owner" | "collaborator" | "none" | undefined
): IntroAudience {
  if (view === "waiter") return "worker";
  return authority === "collaborator" ? "collaborator" : "owner";
}
