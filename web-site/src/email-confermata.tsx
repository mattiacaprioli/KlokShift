import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EmailConfirmedPage, readConfirmOutcome } from "./sections/EmailConfirmedPage";
import "./index.css";

// Terzo entry della vetrina (`email-confermata.html`), come `invito.html`.
//
// ⚠️ L'esito si legge e il fragment si cancella **prima** del render: Supabase
// ci mette i token della sessione appena confermata, che a questa pagina non
// servono e non devono restare nella cronologia né nella barra degli indirizzi.
const outcome = readConfirmOutcome(window.location.hash);
if (window.location.hash) {
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EmailConfirmedPage outcome={outcome} />
  </StrictMode>
);
