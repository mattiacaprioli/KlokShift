/** Sotto questa altezza la barra resta sempre visibile. */
const TOP = 80;
/** Spostamenti più piccoli sono tremolio (trackpad, rimbalzo di iOS). */
const JITTER = 4;

/**
 * Se la barra in alto va nascosta: sì quando si scende, no appena si risale.
 * Mai con il menu aperto, con il focus da tastiera dentro o in cima alla pagina.
 */
export function navHidden(s: {
  prevY: number;
  y: number;
  wasHidden: boolean;
  menuOpen: boolean;
  focusInside: boolean;
}): boolean {
  if (s.menuOpen || s.focusInside || s.y <= TOP) return false;
  if (s.y - s.prevY > JITTER) return true;
  if (s.prevY - s.y > JITTER) return false;
  return s.wasHidden;
}
