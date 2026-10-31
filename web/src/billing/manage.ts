import { supabase } from "@/lib/supabase";
import { UserFacingError } from "@/lib/errors";
import { functionErrorCode } from "@/lib/functionError";

/*
 * Gestione dell'abbonamento dalla pagina Piano (solo dashboard web, come
 * l'acquisto). Nessuna di queste azioni cambia da sola il piano: il nuovo stato
 * arriva con l'avviso firmato di Paddle e la pagina lo rilegge.
 */

export type PortalLinks = { overview: string; paymentMethod: string | null; cancel: string | null };
export type ChangePreview = { currency: string; dueNowCents: number; renewalCents: number };
type ChangeSelection = { workspaceId: string; plan: "base" | "team"; extraVenues: number };
export type ScheduledSelection = { workspaceId: string; plan: "base" | "team"; interval: "month" | "year"; extraVenues: number };
export type ScheduledPreview = { currency: string; renewalCents: number; effectiveAt: string };

const ERRORS: [string, string][] = [
  ["billing_downgrade_unsupported", "Per scendere di piano o togliere sedi usa «Cambia dal prossimo rinnovo»."],
  ["billing_amount_changed", "L'importo del rinnovo è cambiato: guarda il nuovo importo e conferma di nuovo."],
  ["billing_scheduled_not_reduction", "Per aumentare piano o sedi usa il modulo dell'aumento: vale subito."],
  ["billing_change_pending", "C'è già un cambio programmato: annullalo prima di farne un altro o di aumentare il piano."],
  ["billing_too_close_to_renewal", "Mancano meno di 24 ore al rinnovo: per cambiare adesso scrivi a info@klokshift.com."],
  ["billing_change_already_sent", "Il cambio è già stato inviato per il rinnovo: dopo il rinnovo potrai modificare di nuovo il piano."],
  ["billing_scheduled_people", "Il piano Base comprende 30 persone: togli dal team chi non lavora più prima di programmare il cambio."],
  ["billing_scheduled_venues", "Chiudi prima le sedi in più: le sedi aperte devono stare nel piano scelto."],
  ["billing_no_change", "È la stessa scelta che hai già."],
  ["billing_change_scheduled", "C’è già una pausa o una chiusura programmata: annullala prima di cambiare."],
  ["billing_past_due", "Il rinnovo non è andato a buon fine: aggiorna prima il metodo di pagamento."],
  ["billing_paused", "L'abbonamento è in pausa: ripartilo da questa pagina prima di cambiarlo."],
  ["billing_not_paused", "L'abbonamento non è in pausa. Aggiorna la pagina."],
  ["billing_not_needed", "Questa azienda ha l'accesso gratuito: non serve ripartire con un pagamento."],
  ["billing_payment_failed", "Il pagamento della differenza non è andato a buon fine: il piano non è cambiato. Controlla il metodo di pagamento e riprova."],
  ["billing_nothing_scheduled", "I rinnovi sono già attivi."],
  ["billing_no_subscription", "Non risulta un abbonamento attivo per questa azienda. Aggiorna la pagina."],
  ["not_allowed", "Solo il titolare può gestire l'abbonamento di questa azienda."],
  ["not_authenticated", "La sessione è scaduta. Esci e rientra, poi riprova."],
];

async function manage<T>(body: Record<string, unknown>, overrides: Record<string, string> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("billing-manage", { body });
  if (error) {
    const code = `${await functionErrorCode(error)} ${error.message ?? ""}`;
    const known = ERRORS.find(([match]) => code.includes(match));
    const override = Object.entries(overrides).find(([match]) => code.includes(match));
    throw new UserFacingError(override?.[1] ?? known?.[1] ??
      "La gestione dell'abbonamento non è disponibile in questo momento. Riprova fra qualche minuto.");
  }
  if (data === null || data === undefined) {
    throw new UserFacingError("La gestione dell'abbonamento non è disponibile in questo momento. Riprova fra qualche minuto.");
  }
  return data;
}

/** Link temporanei del portale Paddle: si chiedono a ogni clic, non si salvano. */
export async function openPortal(workspaceId: string, target: keyof PortalLinks): Promise<void> {
  // La scheda si apre subito, nel gesto del clic, altrimenti il browser la blocca.
  const tab = window.open("about:blank", "_blank");
  try {
    const links = await manage<PortalLinks>({ action: "portal", workspaceId });
    const url = links[target] ?? links.overview;
    if (tab) { tab.opener = null; tab.location.href = url; } else window.location.assign(url);
  } catch (error) {
    tab?.close();
    throw error;
  }
}

export function resumeRenewals(workspaceId: string): Promise<{ ok: true }> {
  return manage({ action: "resume_renewals", workspaceId });
}

/** Chiude l'abbonamento alla fine del periodo pagato: lo storico resta consultabile. */
export function pauseRenewals(workspaceId: string): Promise<{ ok: true }> {
  return manage({ action: "pause", workspaceId });
}

/** Disdetta a fine periodo pagato, dopo la conferma con il riepilogo. Annullabile con resumeRenewals. */
export function stopRenewals(workspaceId: string): Promise<{ ok: true }> {
  return manage({ action: "cancel", workspaceId });
}

/** Riparte da una pausa: periodo nuovo da oggi, addebitato subito sulla carta salvata. */
export function restartSubscription(workspaceId: string): Promise<{ ok: true }> {
  return manage({ action: "resume", workspaceId });
}

export function previewChange(selection: ChangeSelection): Promise<ChangePreview> {
  return manage({ action: "preview_change", ...selection });
}

export function applyChange(selection: ChangeSelection): Promise<{ ok: true }> {
  return manage({ action: "apply_change", ...selection });
}

/** Riduzione o cambio di ciclo al prossimo rinnovo: l'anteprima non cambia nulla. */
export function previewScheduledChange(sel: ScheduledSelection): Promise<ScheduledPreview> {
  return manage({ action: "preview_scheduled_change", ...sel });
}

/** `expectedRenewalCents` è l'importo mostrato all'anteprima: se Paddle ora dice altro, non si registra nulla. */
export function scheduleChange(sel: ScheduledSelection & { expectedRenewalCents: number }): Promise<{ ok: true }> {
  return manage({ action: "schedule_change", ...sel });
}

export function cancelScheduledChange(workspaceId: string): Promise<{ ok: true }> {
  return manage({ action: "cancel_scheduled_change", workspaceId },
    { billing_nothing_scheduled: "Non c'è un cambio programmato da annullare. Aggiorna la pagina." });
}

export function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(cents / 100);
}
