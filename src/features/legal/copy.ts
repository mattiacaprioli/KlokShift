/** Testi dell'accettazione di termini e DPA: gli stessi nell'app e sulla dashboard. */
export const LEGAL_COPY = {
  checkbox: "Accetto i termini e l'accordo sul trattamento dei dati per conto dell'azienda.",
  title: "Termini e accordo sul trattamento dei dati",
  accept: "Accetto",
  accepting: "Un momento…",
  terms: "Termini e condizioni",
  dpa: "Accordo sul trattamento dei dati",
  switchToWork: "Passa ai tuoi turni",
  signOut: "Esci",
  deleteAccount: "Come eliminare il tuo account",
} as const;

export function legalBody(workspaceName: string): string {
  return `Per continuare a gestire ${workspaceName} serve l'accettazione dei termini e dell'accordo sul trattamento dei dati del team. Basta quella di un titolare.`;
}

export function legalWaiting(workspaceName: string): string {
  return `Il titolare di ${workspaceName} deve accettare i nuovi termini. Finché non lo fa, la gestione resta ferma; i turni e le timbrature del team continuano.`;
}
