// ⚠️ MANUTENZIONE — LEGGERE PRIMA DI TOCCARE IL PRIMO ACCESSO O IL FORM TURNO
// La guida «Il tuo primo turno», in Aiuto (app di chi gestisce e dashboard).
// Segue gli stessi passi della checklist «Primi passi» (`firstSteps.ts`): se
// cambia il percorso, il form del turno (`StaffShiftForm`, `ShiftPanel`) o
// l'aggancio delle persone, AGGIORNA queste righe insieme a quelle.
//
// Solo dati, nessun import di React Native: la dashboard web lo riusa così com'è.

import type { Tutorial } from "@/features/team/tutorialContent";

export const FIRST_SHIFT_TUTORIAL: Tutorial = {
  title: "Il tuo primo turno in 2 minuti",
  intro:
    "Dalla sede vuota al primo turno confermato: quattro passi, e la Home ti segna quelli fatti.",
  sections: [
    {
      title: "I passi",
      steps: [
        "Ruoli: scegli cosa fa la gente da te (Sala, Bar, Cucina…). Bastano quelli che usi davvero.",
        "Team: aggiungi le persone con nome ed email. Lavori anche tu? Mettiti nel team.",
        "Turno: premi «Nuovo turno» in Home (o il «+» in Turni), scegli giorno, orario e chi lavora.",
        "Fatto: le persone ricevono la notifica e confermano dall'app con un tocco.",
      ],
    },
    {
      title: "Da sapere",
      points: [
        "L'email è quella che fa entrare la persona nell'app: si registra con quella e trova subito i suoi turni.",
        "Chi è fisso risulta già in turno; chi è a chiamata conferma. Puoi chiedere la conferma a tutti dal form del turno.",
        "Un turno che si ripete uguale salvalo come modello, oppure usa «Duplica» per copiare la settimana.",
        "Un turno già passato e mai segnato si registra a posteriori: scegli quel giorno nei turni e aggiungilo, oppure parti dalla pagina Ore.",
      ],
    },
  ],
};
