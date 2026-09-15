import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { InvitePage } from "./sections/InvitePage";
import "./index.css";

// Secondo entry della vetrina (`invito.html`), non una rotta: qui non c'è un
// router, e Pages non fa fallback SPA.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <InvitePage />
  </StrictMode>
);
