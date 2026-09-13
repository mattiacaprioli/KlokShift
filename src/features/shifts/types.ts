import type { Tables } from "@/types/database";
import type {
  CoverageEmbeds,
  RoleRequirementEmbed,
} from "@/features/assignments/coverage";
import type { AssignmentStatus } from "@/features/assignments/status";

export type Shift = Tables<"shifts">;

/**
 * Turno + le relazioni della copertura per ruolo. Serve alle viste a calendario:
 * "quanto manca" si legge dai ruoli richiesti e da chi viene davvero, non dal
 * conteggio grezzo degli assegnati (che ignora ruoli e rifiuti).
 */
export type ShiftWithCoverage = Shift & CoverageEmbeds;

/**
 * Alias storico di `ShiftWithCoverage`: il nome resta perché è quello usato
 * dagli elenchi del locale. Portava anche `applications(count)` finché il turno
 * poteva essere un annuncio con delle candidature.
 */
export type ShiftWithCount = ShiftWithCoverage;

/**
 * Turno con le sue relazioni **e l'identità** di chi è assegnato. Serve alle
 * viste che pivotano per persona ("chi lavora quanto questa settimana"), dove
 * il ruolo non basta: serve sapere di chi si parla.
 *
 * È un sovrainsieme di `CoverageEmbeds`, quindi `shiftCoverage()` lo accetta
 * senza conversioni.
 */
export type ShiftWithAssignees = Shift & {
  shift_role_requirements: RoleRequirementEmbed[];
  shift_assignments: {
    /** Identità della riga: è l'assegnazione a spostarsi, non la persona. */
    id: string;
    status: AssignmentStatus;
    /** Il ruolo ricoperto **su questo turno**, non quello dell'anagrafica. */
    role_id: string | null;
    role: { id: string; name: string } | null;
    staff_member: {
      id: string;
      display_name: string;
      /**
       * La **persona** dietro l'appartenenza: è la chiave con cui il carico
       * settimanale incrocia i turni delle altre sedi del titolare, perché le
       * soglie 40/48h sono della persona e non del locale.
       */
      person_id: string;
      /** Senza account collegato non c'è nessuno da notificare. */
      waiter_id: string | null;
    } | null;
  }[];
};

/**
 * Un turno in un'**altra** sede del titolare, ridotto all'osso.
 *
 * Serve a una cosa sola: sommare le ore già programmate altrove alla stessa
 * persona. Nessun fabbisogno di ruolo, nessun `waiter_id` — non si pianifica una
 * sede che non stai guardando, e quello che non serve non si scarica.
 */
export type ElsewhereShift = Pick<
  Shift,
  "id" | "venue_id" | "date" | "start_time" | "end_time" | "status"
> & {
  venue: { id: string; name: string } | null;
  shift_assignments: {
    id: string;
    status: AssignmentStatus;
    staff_member: { id: string; person_id: string } | null;
  }[];
};

export type ShiftWithVenue = Shift & {
  venue: Tables<"venues"> | null;
};
