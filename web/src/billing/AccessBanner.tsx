import { Link } from "react-router-dom";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";

/**
 * Perché i pulsanti non funzionano. Senza prova né abbonamento (o in archivio)
 * il server rifiuta turni, persone e nuove sedi: lo si dice prima che il
 * titolare inciampi in un errore. Solo nella Home: nelle altre pagine, con le
 * loro intestazioni e tabelle, l'avviso finiva tagliato.
 */
export function AccessBanner() {
  const { access, accessError, isOwner } = useOwnerVenues();
  if (accessError || !access) return null;

  const text = access.state === "setup"
    ? isOwner
      ? "L’azienda è pronta, ma il lavoro non è ancora attivo: avvia la prova gratuita di 30 giorni o attiva un abbonamento per creare turni e aggiungere persone."
      : "Il lavoro non è ancora attivo per questa azienda: il titolare può avviare la prova o attivare un abbonamento."
    : access.state === "archive"
      ? isOwner
        ? "L’operatività è terminata: puoi consultare ed esportare lo storico. Per tornare a creare turni attiva un abbonamento."
        : "L’operatività dell’azienda è terminata: puoi consultare lo storico. Il titolare può riattivarla."
      : access.source === "payment_grace"
        ? isOwner
          ? "Il rinnovo dell’abbonamento non è andato a buon fine: per qualche giorno si lavora ancora, poi resta la sola consultazione."
          : "Il rinnovo dell’abbonamento è in sospeso: il titolare può sistemarlo."
        : null;
  if (!text) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-gold bg-gold/10 px-4 py-3 print:hidden" role="status">
      <p className="text-sm text-t1">{text}</p>
      {isOwner ? <Link className="focus-gold text-sm font-medium text-gold underline" to="/piano">Vai a Piano e accesso</Link> : null}
    </div>
  );
}
