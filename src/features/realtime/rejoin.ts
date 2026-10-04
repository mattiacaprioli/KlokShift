// Recupero dopo una caduta del realtime (audit B10).
//
// Modulo **puro**: nessun import di Supabase o React, così si prova da solo.
//
// Quando il websocket cade — rete persa, app sospesa in background, scheda del
// browser congelata — il client Supabase rientra nei canali da solo e la
// callback di `.subscribe()` riceve di nuovo `SUBSCRIBED` (Phoenix rimanda la
// stessa join, con gli stessi gestori). Gli eventi `postgres_changes` arrivati
// nel frattempo però **non** vengono rimandati: senza un riallineamento la
// pagina resterebbe ferma a prima della caduta finché non si naviga.
//
// Il primo `SUBSCRIBED` non fa nulla: le query sono appena partite. Ogni
// `SUBSCRIBED` successivo è un rientro, e si rileggono una volta le chiavi che
// quel canale avrebbe invalidato. Niente polling, niente invalidazione globale.

export type SubscribeStatus =
  | "SUBSCRIBED"
  | "TIMED_OUT"
  | "CLOSED"
  | "CHANNEL_ERROR";

export type RejoinWatcher = {
  /** Da passare a `channel.subscribe(...)`. */
  onStatus: (status: `${SubscribeStatus}`) => void;
  /** Da chiamare nel cleanup dell'effetto: un rientro tardivo non fa più nulla. */
  stop: () => void;
};

export function watchRejoin(recover: () => void): RejoinWatcher {
  let joined = false;
  let active = true;
  return {
    onStatus: (status) => {
      if (!active || status !== "SUBSCRIBED") return;
      if (joined) recover();
      joined = true;
    },
    stop: () => {
      active = false;
    },
  };
}
