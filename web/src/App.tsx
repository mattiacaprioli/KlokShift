import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { RealtimeSync } from "@/features/realtime/RealtimeSync";
import {
  OwnerVenuesProvider,
  useOwnerVenues,
} from "@/features/venues/OwnerVenues";
import { Spinner } from "./ui/primitives";
import { AppLayout } from "./AppLayout";
import { NotificationsWatcher } from "./NotificationsWatcher";
import { LoginPage } from "./pages/Login";
import { RegistrazionePage } from "./pages/Registrazione";
import { NotForWaitersPage } from "./pages/NotForWaiters";
import { NuovaPasswordPage } from "./pages/NuovaPassword";
import { HomePage } from "./pages/Home";
import { StoricoPage } from "./pages/Storico";
import { NotifichePage } from "./pages/Notifiche";
import { ChatPage } from "./pages/Chat";
import { PlanningPage } from "./pages/Planning";
import { OrePage } from "./pages/Ore";
import { StaffPage } from "./pages/Staff";
import { RuoliPage } from "./pages/Ruoli";
import { ProfessionistaPage } from "./pages/Professionista";
import { SedePage } from "./pages/Sede";
import { SedeNuovaPage } from "./pages/SedeNuova";
import { SedeDettaglioPage } from "./pages/SedeDettaglio";
import { TeamPage } from "./pages/Team";
import { ImpostazioniPage } from "./pages/Impostazioni";

export function App() {
  const { session, profile, loading } = useAuth();
  const { pathname } = useLocation();

  if (loading) return <Spinner label="Verifica sessione…" />;

  // Davanti a ogni gate: chi arriva dal link di recupero ha una sessione (di
  // recupero) ma deve poter fare una cosa sola, e se il link è scaduto la
  // pagina lo spiega da sé. Un redirect qui lo lascerebbe fuori per sempre.
  if (pathname === "/nuova-password") return <NuovaPasswordPage />;

  // Fuori sessione esistono due sole pagine. Il catch-all riporta al login
  // anche il fragment che Supabase lascia nell'URL dopo la conferma email
  // (il client web ha `detectSessionInUrl: false`: quei token non servono, e
  // senza `replace` resterebbero scritti nella barra degli indirizzi).
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/registrati" element={<RegistrazionePage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (!profile) return <Spinner label="Caricamento profilo…" />;

  return (
    // Sopra tutto il resto: `RealtimeSync` deve sapere quali sedi ascoltare,
    // `AppLayout` quante sono, e il gate qui sotto se questa persona ha una
    // delega — che per un professionista promosso (F3) è l'unica cosa che lo
    // distingue da un professionista qualunque.
    <OwnerVenuesProvider>
      <Dashboard userId={session.user.id} isManager={profile.role === "manager"} />
    </OwnerVenuesProvider>
  );
}

/**
 * La dashboard vera, dentro `OwnerVenuesProvider`.
 *
 * Il gate del professionista sta qui e non in `App` perché la risposta arriva
 * dal provider: dal 16/09/2026 un membro dell'organico può essere promosso a
 * gestire una sede senza che il suo ruolo cambi, quindi `role !== 'manager'` da
 * solo non basta più a dire «questa pagina non fa per te».
 */
function Dashboard({
  userId,
  isManager,
}: {
  userId: string;
  isManager: boolean;
}) {
  const { hasVenueAccess, isPending } = useOwnerVenues();

  // Prima di sapere se ha una delega non si può rispondere: mostrargli
  // `NotForWaitersPage` e poi sostituirla con la dashboard sarebbe peggio di
  // un attimo di attesa.
  if (!isManager && isPending) return <Spinner label="Caricamento…" />;

  // La dashboard è uno strumento da scrivania per chi gestisce una sede. Il
  // professionista non ha nulla da farci: schermata esplicita, non un redirect
  // silenzioso che lo lascerebbe a chiedersi cosa è andato storto.
  if (!isManager && !hasVenueAccess) return <NotForWaitersPage />;

  return (
    <>
      {/* Stesso listener dell'app: la dashboard si aggiorna sola quando il
          gestore tocca qualcosa dal telefono. */}
      <RealtimeSync userId={userId} role="manager" />
      {/* RealtimeSync non copre la tabella `notifications`: ci pensa questo,
          come NotificationsListener sull'app. */}
      <NotificationsWatcher userId={userId} />
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/planning" element={<PlanningPage />} />
          <Route path="/storico" element={<StoricoPage />} />
          <Route path="/ore" element={<OrePage />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="/ruoli" element={<RuoliPage />} />
          {/* Profilo pubblico: si arriva dall'organico o dal dettaglio di un
              turno, non c'è una voce di menu (non è una lista da sfogliare). */}
          <Route
            path="/professionista/:id"
            element={<ProfessionistaPage />}
          />
          <Route path="/notifiche" element={<NotifichePage />} />
          {/* Stessa pagina con e senza thread aperto: la lista resta a sinistra. */}
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/:id" element={<ChatPage />} />
          <Route path="/sede" element={<SedePage />} />
          <Route path="/sede/nuovo" element={<SedeNuovaPage />} />
          {/* Dopo "nuovo", o il match lo intercetterebbe come un id. */}
          <Route path="/sede/:id" element={<SedeDettaglioPage />} />
          <Route path="/collaboratori" element={<TeamPage />} />
          <Route path="/impostazioni" element={<ImpostazioniPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}
