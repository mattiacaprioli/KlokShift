import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

// Nessun provider: la vetrina non ha sessione, né cache, né router. Una pagina
// sola, ancore per la navigazione.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
