// ⚠️ MANUTENZIONE — LEGGERE PRIMA DI TOCCARE LA FEATURE COLLABORATORI
// È il testo della voce «Tutorial» nelle impostazioni del titolare, in app e sulla
// dashboard. Descrive il flusso com'è oggi nel codice: se cambi l'invito
// (`addTeamMember`, `invite-staff`, `accept-invite`), i permessi
// (`TEAM_PERMISSION_LABEL`) o la promozione dall'organico (`PromoteSection`),
// AGGIORNA queste righe, altrimenti il tutorial spiega un'app che non esiste più.
//
// Solo dati, nessun import di React Native: la dashboard web lo riusa così com'è.

import { TEAM_PERMISSIONS, TEAM_PERMISSION_LABEL } from "./api";

export type TutorialSection = {
  title: string;
  /** Passi in ordine: si mostrano numerati. */
  steps?: string[];
  /** Punti senza un ordine: si mostrano come elenco. */
  points?: string[];
};

export type Tutorial = {
  title: string;
  intro: string;
  sections: TutorialSection[];
};

const permissionList = TEAM_PERMISSIONS.map((p) => TEAM_PERMISSION_LABEL[p]).join(
  ", "
);

export const COLLABORATOR_TUTORIAL: Tutorial = {
  title: "Aggiungere un collaboratore",
  intro:
    "Un collaboratore gestisce le tue sedi insieme a te, con un account tutto suo e solo i permessi che scegli. Niente più credenziali condivise.",
  sections: [
    {
      title: "Cosa devi fare",
      steps: [
        "Apri Impostazioni → Collaboratori e premi «Invita un collaboratore» (sulla dashboard: Collaboratori, nel menu).",
        "Scrivi l'email della persona.",
        "Se hai più sedi, scegli su quali entra.",
        `Scegli cosa può fare: ${permissionList}. Di partenza sono accesi solo i Turni.`,
        "Premi «Invita».",
      ],
    },
    {
      title: "Cosa succede dopo",
      points: [
        "Se ha già un account da sede con l'email confermata, l'accesso parte subito e gli arriva una notifica.",
        "Altrimenti riceve un'email con un link: lo apre, sceglie una password ed è dentro, senza registrarsi. Il link vale 7 giorni e si usa una volta sola.",
        "Finché non apre il link non viene creato nessun account: se l'email era sbagliata, non resta niente a suo nome.",
        "Quando entra ti arriva la notifica «Invito accettato». Nella lista, fino a quel momento, lo vedi come «Invito mandato».",
      ],
    },
    {
      title: "Cosa puoi fare in seguito",
      points: [
        "Rimandare l'invito dalla lista dei collaboratori («Reinvia»), se il link è scaduto o l'email si è persa. Il link vecchio smette di funzionare. Puoi rimandarlo al massimo una volta ogni 15 minuti.",
        "Cambiare i permessi sede per sede, sempre dalla lista: chi gestisce due sedi può fare cose diverse in ognuna.",
        "Togliere l'accesso a una sede («Togli l'accesso»); in app c'è anche «Revoca tutto». Gli arriva una notifica, e turni, presenze e ore che ha già registrato restano dove sono.",
        "Far gestire una sede a qualcuno che lavora già nel tuo organico: apri la sua scheda nello Staff e usa «Fagli gestire la sede». Nessuna email, e resta anche un professionista con i suoi turni.",
      ],
    },
    {
      title: "Da sapere",
      points: [
        "Restano solo tuoi: aprire e chiudere sedi, invitare altri collaboratori, i messaggi e l'account.",
        "Un indirizzo che ha già un account da professionista non si può invitare come collaboratore: serve un'altra email, oppure la strada dell'organico qui sopra.",
        "Un collaboratore lavora con una sola azienda alla volta, e finché è collaboratore non può aprire sedi sue.",
      ],
    },
  ],
};
