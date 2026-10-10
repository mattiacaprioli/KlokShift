// ⚠️ MANUTENZIONE — LEGGERE PRIMA DI TOCCARE LA FEATURE COLLABORATORI
// È il testo della voce «Tutorial» nelle impostazioni del titolare, in app e sulla
// dashboard. Descrive il flusso com'è oggi nel codice: se cambi l'invito
// (`addTeamMember`, `invite-staff`, `accept-invite`), i permessi
// (`TEAM_PERMISSION_LABEL`, `set_member_access`, l'ambito delle sedi) o la
// promozione dall'organico (`PromoteSection`),
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
        "Scrivi nome, cognome ed email della persona.",
        "Se hai più sedi, puoi scegliere su quali entra («Dove»): se non ne scegli nessuna, vale su tutte, anche quelle che aprirai.",
        `Scegli cosa può fare: ${permissionList}. Si parte con tutto spento: devi accenderne almeno uno.`,
        "Premi «Invita».",
      ],
    },
    {
      title: "Cosa succede dopo",
      points: [
        "Se ha già un account KlokShift, anche da professionista, gli arriva una notifica e trova l'invito da accettare nell'app: l'accesso parte quando lo accetta.",
        "Altrimenti riceve un'email con un link: lo apre, sceglie una password ed è dentro, senza registrarsi. Il link vale 7 giorni e si usa una volta sola.",
        "Finché non apre il link non viene creato nessun account: se l'email era sbagliata, non resta niente a suo nome.",
        "Quando entra ti arriva una notifica: «Invito accettato», oppure «Scheda collegata» se ha creato l'account dal link. Nella lista, fino a quel momento, lo vedi come «Invito mandato».",
      ],
    },
    {
      title: "Cosa puoi fare in seguito",
      points: [
        "Rimandare l'invito dalla lista dei collaboratori («Reinvia»), se il link è scaduto o l'email si è persa. Il link vecchio smette di funzionare. Puoi rimandarlo al massimo una volta ogni 15 minuti, e non più di 5 volte in tutto.",
        "Cambiare i permessi e le sedi su cui vale l'accesso, sempre dalla lista (in app con «Modifica»). I permessi sono gli stessi per tutte le sedi che gestisce.",
        "Togliere l'accesso alla gestione («Togli l'accesso»): vale per tutta l'azienda. Gli arriva una notifica, turni, presenze e ore che ha già registrato restano dove sono e, se lavora con voi, resta nell'organico. Per toglierlo solo da alcune sedi, cambia «Dove».",
        "Far gestire l'azienda a qualcuno che lavora già nel tuo organico e ha l'account collegato: apri la sua scheda nello Staff e usa «Fagli gestire l'azienda». Nessuna email, e resta anche un professionista con i suoi turni.",
      ],
    },
    {
      title: "Da sapere",
      points: [
        "Restano solo tuoi: aprire e chiudere sedi, invitare altri collaboratori e l'account.",
        "Le richieste dei professionisti (assenze, cambi turno) arrivano come card nella tua chat con loro. Un collaboratore con il permesso sull'organico riceve la notifica delle assenze e le decide dallo Staff.",
      ],
    },
  ],
};
