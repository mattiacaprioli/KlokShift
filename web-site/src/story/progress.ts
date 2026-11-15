/**
 * Il passo attivo della storia, dato quanto della sezione è stato scorso
 * (0 = i passi non sono ancora arrivati al centro dello schermo, 1 = fine).
 * `-1` vuol dire «non ancora iniziata»: l'oggetto aspetta, così il primo
 * momento (bozza → pubblicata) non si consuma mentre si legge l'apertura.
 * Motion può dare valori appena fuori da 0–1 durante un salto da ancora: il
 * risultato è sempre -1 o un passo che esiste.
 */
export function activeStep(progress: number, steps: number): number {
  if (!(progress > 0)) return -1;
  return Math.min(steps - 1, Math.floor(progress * steps));
}

/**
 * Come si comporta l'oggetto della storia:
 * - `final`: subito lo stato finale, senza timer (passi in colonna, reduced motion);
 * - `paused`: fermo all'inizio, senza timer (la storia non è ancora in vista);
 * - `live`: i piccoli momenti del passo partono (bozza → pubblicata, la conferma…).
 */
export function visualMode(s: {
  still: boolean;
  reduce: boolean;
  started: boolean;
}): "final" | "paused" | "live" {
  if (s.still || s.reduce) return "final";
  return s.started ? "live" : "paused";
}
