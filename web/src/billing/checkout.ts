import { supabase } from "@/lib/supabase";
import { UserFacingError } from "@/lib/errors";
import { functionErrorCode } from "@/lib/functionError";

/*
 * Acquisto dalla pagina Piano. Solo dashboard web: l'app nativa non mostra
 * prezzi né checkout (App Store 3.1.3). Il pagamento completato nel browser
 * non concede nulla: il piano si attiva quando arriva l'avviso firmato di
 * Paddle (`paddle-webhook`), e la pagina rilegge lo stato finché non c'è.
 */

export type CheckoutSelection = {
  workspaceId: string;
  plan: "base" | "team";
  interval: "month" | "year";
  extraVenues: number;
};

type PreparedCheckout = {
  transactionId: string;
  environment: "sandbox" | "live";
  clientToken: string;
  email: string | null;
};

const ERRORS: [string, string][] = [
  ["billing_subscription_exists", "Questa azienda ha già un abbonamento attivo."],
  ["billing_not_required", "Questa azienda ha un accesso gratuito permanente: non serve acquistare."],
  ["workspace_people_capacity", "Il piano Base arriva a 30 persone: l'organico di oggi è più grande. Scegli Team."],
  ["workspace_venue_capacity", "Le sedi aperte sono più di quelle scelte. Aumenta il numero di sedi."],
  ["billing_checkout_rate_limited", "Troppi tentativi in poco tempo. Riprova fra un'ora."],
  ["not_allowed", "Solo il titolare può acquistare per questa azienda."],
  ["not_authenticated", "La sessione è scaduta. Esci e rientra, poi riprova."],
];

export async function prepareCheckout(selection: CheckoutSelection): Promise<PreparedCheckout> {
  const { data, error } = await supabase.functions.invoke<PreparedCheckout>("billing-checkout", {
    body: selection,
  });
  if (error) {
    const code = `${await functionErrorCode(error)} ${error.message ?? ""}`;
    const known = ERRORS.find(([match]) => code.includes(match));
    throw new UserFacingError(known?.[1] ??
      "Il pagamento non è disponibile in questo momento. Riprova fra qualche minuto.");
  }
  if (!data || typeof data.transactionId !== "string" || !/^txn_[a-z0-9]+$/.test(data.transactionId) ||
      (data.environment !== "sandbox" && data.environment !== "live") || typeof data.clientToken !== "string") {
    throw new UserFacingError("Il pagamento non è disponibile in questo momento. Riprova fra qualche minuto.");
  }
  return data;
}

type PaddleEvent = { name?: string };
type PaddleGlobal = {
  Environment: { set: (environment: "sandbox") => void };
  Initialize: (options: { token: string; eventCallback: (event: PaddleEvent) => void }) => void;
  Checkout: {
    open: (options: {
      transactionId: string;
      customer?: { email: string };
      settings: { displayMode: "overlay"; locale: string; theme: "light" };
    }) => void;
  };
};
declare global {
  interface Window { Paddle?: PaddleGlobal }
}

// Versione 2 di Paddle.js, sempre dal loro CDN (non si impacchetta).
const PADDLE_JS = "https://cdn.paddle.com/paddle/v2/paddle.js";
let loading: Promise<PaddleGlobal> | null = null;
let initializedWith: string | null = null;
let listener: ((event: PaddleEvent) => void) | null = null;

function loadPaddle(): Promise<PaddleGlobal> {
  if (window.Paddle) return Promise.resolve(window.Paddle);
  loading ??= new Promise<PaddleGlobal>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PADDLE_JS;
    script.async = true;
    script.onload = () => window.Paddle ? resolve(window.Paddle) : reject(new Error("paddle_unavailable"));
    script.onerror = () => { loading = null; reject(new Error("paddle_unavailable")); };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Apre il checkout di Paddle sulla transazione creata dal server. Risolve con
 * `completed` quando il cliente ha pagato, `closed` se chiude la finestra.
 */
export async function openCheckout(prepared: PreparedCheckout): Promise<"completed" | "closed"> {
  let paddle: PaddleGlobal;
  try {
    paddle = await loadPaddle();
  } catch {
    throw new UserFacingError("Non riesco a caricare la pagina di pagamento. Controlla la connessione o eventuali blocchi del browser.");
  }
  // Paddle.Initialize vale una volta per pagina: l'ambiente non cambia senza ricaricare.
  if (initializedWith === null) {
    if (prepared.environment === "sandbox") paddle.Environment.set("sandbox");
    paddle.Initialize({ token: prepared.clientToken, eventCallback: (event) => listener?.(event) });
    initializedWith = prepared.clientToken;
  } else if (initializedWith !== prepared.clientToken) {
    throw new UserFacingError("La configurazione dei pagamenti è cambiata. Ricarica la pagina e riprova.");
  }
  return new Promise((resolve) => {
    // Al pagamento riuscito si risponde subito: la finestra di Paddle mostra
    // la conferma e il cliente la chiude quando vuole.
    listener = (event) => {
      if (event.name === "checkout.completed" || event.name === "checkout.closed") {
        listener = null;
        resolve(event.name === "checkout.completed" ? "completed" : "closed");
      }
    };
    paddle.Checkout.open({
      transactionId: prepared.transactionId,
      // Precompilata con l'email dell'account, ma modificabile: le ricevute
      // possono andare a un altro indirizzo (es. il commercialista).
      ...(prepared.email ? { customer: { email: prepared.email } } : {}),
      settings: { displayMode: "overlay", locale: "it", theme: "light" },
    });
  });
}
