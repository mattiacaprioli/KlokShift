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
  Initialize: (options: {
    token: string;
    eventCallback: (event: PaddleEvent) => void;
    checkout?: { settings: { displayMode: "overlay"; locale: string; theme: "light" } };
  }) => void;
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

const CHECKOUT_SETTINGS = { displayMode: "overlay", locale: "it", theme: "light" } as const;

/** Paddle.Initialize vale una volta per pagina: l'ambiente non cambia senza ricaricare. */
function ensureInitialized(paddle: PaddleGlobal, environment: "sandbox" | "live", clientToken: string) {
  if (initializedWith === null) {
    if (environment === "sandbox") paddle.Environment.set("sandbox");
    paddle.Initialize({ token: clientToken, eventCallback: (event) => listener?.(event),
      // Le impostazioni valgono anche per il checkout che Paddle apre da solo con `_ptxn`.
      checkout: { settings: CHECKOUT_SETTINGS } });
    initializedWith = clientToken;
  } else if (initializedWith !== clientToken) {
    throw new UserFacingError("La configurazione dei pagamenti è cambiata. Ricarica la pagina e riprova.");
  }
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
  ensureInitialized(paddle, prepared.environment, prepared.clientToken);
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
      settings: CHECKOUT_SETTINGS,
    });
  });
}

/** La transazione di un link Paddle (`?_ptxn=txn_…`), se l'indirizzo ne ha una valida. */
export function paymentLinkTransaction(search: string): string | null {
  const txn = new URLSearchParams(search).get("_ptxn");
  return txn && /^txn_[a-z0-9]+$/.test(txn) ? txn : null;
}

/**
 * Link delle email di Paddle (aggiornare la carta dopo un rinnovo non riuscito,
 * pagare una transazione): portano al link di pagamento predefinito, cioè la
 * dashboard, con `?_ptxn=`. Basta caricare e inizializzare Paddle.js, anche
 * prima del login: il pagamento lo apre Paddle. A finestra chiusa il parametro
 * si toglie, così ricaricando non riparte. Il diritto arriva comunque solo
 * dall'avviso firmato.
 */
export async function openPaymentLink(): Promise<void> {
  if (!paymentLinkTransaction(window.location.search)) return;
  const { data } = await supabase.functions.invoke<{ environment?: unknown; clientToken?: unknown }>(
    "billing-checkout", { body: { action: "client_config" } });
  const environment = data?.environment;
  if ((environment !== "sandbox" && environment !== "live") || typeof data?.clientToken !== "string") return;
  try {
    const paddle = await loadPaddle();
    listener = (event) => {
      if (event.name === "checkout.completed" || event.name === "checkout.closed") {
        listener = null;
        const url = new URL(window.location.href);
        url.searchParams.delete("_ptxn");
        window.history.replaceState(null, "", url.toString());
      }
    };
    ensureInitialized(paddle, environment, data.clientToken);
  } catch {
    // Senza Paddle.js il cliente vede la dashboard; il link dell'email resta valido.
  }
}
