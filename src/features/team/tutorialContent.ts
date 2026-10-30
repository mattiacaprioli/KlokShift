// ⚠️ MANUTENZIONE — LEGGERE PRIMA DI TOCCARE LA FEATURE COLLABORATORI
// È il testo della voce «Tutorial» nelle impostazioni del titolare, in app e sulla
// dashboard. Descrive il flusso com'è oggi nel codice: se cambi l'invito
// (`addTeamMember`, `invite-staff`, `accept-invite`), i permessi
// (`TEAM_PERMISSION_LABEL`, `set_member_access`, l'ambito delle sedi) o la
// promozione dal team (`PromoteSection`),
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
    "Un collaboratore ti aiuta a gestire le sedi, con un account suo e solo i permessi che scegli tu. Niente password condivise.",
  sections: [
    {
      title: "Cosa devi fare",
      steps: [
        "Apri Menu › Collaboratori e premi «Invita un collaboratore» (sulla dashboard: Collaboratori, nel menu).",
        "Scrivi nome, cognome ed email della persona.",
        "Se hai più sedi, scegli dove può lavorare («Dove»). Se non ne scegli nessuna, vale per tutte, anche quelle future.",
        `Scegli cosa può fare: ${permissionList}. Partono tutti spenti: accendine almeno uno.`,
        "Premi «Invita».",
      ],
    },
    {
      title: "Cosa succede dopo",
      points: [
        "Se ha già KlokShift (anche da dipendente), trova l'invito nell'app: entra quando lo accetta.",
        "Altrimenti riceve un'email: apre il link, sceglie una password ed è dentro. Il link vale 7 giorni e funziona una volta sola.",
        "Finché non apre il link non esiste nessun account: se l'email era sbagliata, non resta niente.",
        "Quando entra ti arriva una notifica. Fino ad allora nella lista lo vedi come «Invito mandato».",
      ],
    },
    {
      title: "Cosa puoi fare in seguito",
      points: [
        "Rimandare l'invito («Reinvia»), se il link è scaduto o l'email si è persa. Puoi farlo ogni 15 minuti, fino a 5 volte.",
        "Cambiare permessi e sedi dalla lista (in app con «Modifica»). I permessi valgono uguali in tutte le sue sedi.",
        "Togliere l'accesso («Togli l'accesso»): vale per tutta l'azienda. Quello che ha già fatto resta, e se lavora nei turni resta nel team. Per toglierlo solo da alcune sedi, cambia «Dove».",
        "Far gestire l'azienda a qualcuno che è già nel tuo team: apri la sua scheda in Team e usa «Fagli gestire l'azienda». Nessuna email, e continua a fare i suoi turni.",
      ],
    },
    {
      title: "Da sapere",
      points: [
        "Restano solo a te: aprire e chiudere sedi, invitare collaboratori e il piano dell'azienda.",
        "Le richieste dei dipendenti (assenze, cambi turno) arrivano nella tua chat con loro. Un collaboratore con il permesso «Team» vede e decide le assenze dalla voce «Assenze» del menu.",
      ],
    },
  ],
};
