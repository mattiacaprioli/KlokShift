/**
 * Il colore con cui si riconosce una sede a colpo d'occhio.
 *
 * ⚠️ È il segnale **secondario**: quello primario è il nome, sempre scritto
 * accanto. Con tre o più sedi una legenda cromatica è impossibile da imparare, è
 * inaccessibile a chi non distingue i colori, e il planning web si stampa — in
 * bianco e nero il colore sparisce e il nome resta.
 *
 * Per **indice** e non per hash del nome o dell'id: due sedi non collidono mai, e
 * l'ordine di `venues` è stabile (`created_at` crescente). Chiudendo una sede i
 * colori di quelle dopo scalano di uno: è accettabile proprio perché il nome è la
 * verità e il colore è solo un appiglio.
 *
 * Tinte scelte per stare sul fondo scuro dell'app **e** sul bianco della
 * dashboard: nessun import, nessuna dipendenza dal tema.
 */
const VENUE_ACCENTS = [
  "#EAB54C", // oro — la prima sede tiene il colore del marchio
  "#6FB3D9", // azzurro
  "#8FC98A", // verde
  "#D98FA8", // rosa
  "#B79BE0", // viola
  "#E2922F", // ambra
] as const;

export function venueAccent(index: number): string {
  // Il modulo tiene in piedi anche un indice fuori scala (sede non più in
  // elenco, chiusa fra un render e l'altro): meglio un colore ripetuto che
  // `undefined` in mezzo a un bordo.
  return VENUE_ACCENTS[((index % VENUE_ACCENTS.length) + VENUE_ACCENTS.length) %
    VENUE_ACCENTS.length];
}

export const VENUE_ACCENT_COUNT = VENUE_ACCENTS.length;
