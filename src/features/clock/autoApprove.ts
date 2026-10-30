/**
 * Le parole dell'approvazione delle timbrature in orario, uguali in app e
 * dashboard. «In orario» = stesse ore del turno, al quarto d'ora
 * (`isRegularPendingClock`, gemello di `private.clock_record_is_regular`).
 */
export const AUTO_APPROVE_TITLE = "Approva da sole le timbrature in orario";

export function autoApproveHint(on: boolean): string {
  return on
    ? "Attivo: quando le ore timbrate sono quelle del turno, contano subito. Uscita mancante, ore diverse, fuori turno e collaboratori restano da approvare a mano."
    : "Spento: ogni timbratura la approva chi ha il permesso «Ore». Puoi comunque approvare in blocco quelle in orario dalla pagina Ore.";
}

export function approveRegularLabel(count: number): string {
  return count === 1
    ? "Approva 1 timbratura in orario"
    : `Approva ${count} timbrature in orario`;
}

export function approvedRegularToast(count: number): string {
  return count === 1 ? "1 timbratura approvata" : `${count} timbrature approvate`;
}

/** Accanto a «Approvato», quando nessuno l'ha guardata. */
export const AUTO_APPROVED_LABEL = "Approvato in automatico";
