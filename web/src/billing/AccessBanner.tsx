import { Link, useLocation } from "react-router-dom";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { ButtonLink, noticeClass } from "../ui/primitives";

/** Pagine che spiegano già lo stato dell'azienda da sé. */
const HIDDEN_ON = ["/piano", "/aiuto", "/impostazioni"];

/**
 * Perché i pulsanti non funzionano. Senza prova né abbonamento (o in archivio)
 * il server rifiuta turni, persone e nuove sedi: lo si dice prima che il
 * titolare inciampi in un errore. Montato una volta in `AppLayout`, sopra la
 * pagina e fuori dalle sue tabelle (dentro, finiva tagliato): così lo si vede
 * proprio dove i pulsanti non rispondono — Staff, Planning — e non solo in Home.
 */
export function AccessBanner() {
  const { pathname } = useLocation();
  const { access, accessError, isOwner } = useOwnerVenues();
  if (accessError || !access || HIDDEN_ON.includes(pathname)) return null;
  // In Home la prova la propone già la card «Primi passi», col suo pulsante: tre
  // «Avvia la prova» nella stessa schermata erano troppi (15/11).
  if (access.state === "setup" && isOwner && pathname === "/") return null;

  const text = access.state === "setup"
    ? isOwner
      ? "L’azienda è pronta: avvia la prova gratuita di 30 giorni, senza carta, per aggiungere persone e creare turni."
      : "Il lavoro non è ancora attivo per questa azienda: il titolare può avviare la prova o attivare un abbonamento."
    : access.state === "archive"
      ? isOwner
        ? "L’azienda non è più attiva: puoi consultare ed esportare lo storico. Per tornare a creare turni attiva un abbonamento."
        : "L’azienda non è più attiva: puoi consultare lo storico. Il titolare può riattivarla."
      : access.source === "payment_grace"
        ? isOwner
          ? "Il rinnovo dell’abbonamento non è andato a buon fine: per qualche giorno si lavora ancora, poi resta la sola consultazione."
          : "Il rinnovo dell’abbonamento è in sospeso: il titolare può sistemarlo."
        : null;
  if (!text) return null;
  return (
    <div className={noticeClass("gold", "flex flex-wrap items-center justify-between gap-3 print:hidden")} role="status">
      <p className="text-sm text-t1">{text}</p>
      {isOwner && access.state === "setup" && (access.usage?.venues ?? 0) > 0 ? (
        <ButtonLink variant="gold" to="/prova">Avvia la prova</ButtonLink>
      ) : isOwner ? (
        <Link className="focus-gold text-sm font-medium text-gold underline" to="/piano">Vai a Piano e accesso</Link>
      ) : null}
    </div>
  );
}
