import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { RealtimeSync } from "@/features/realtime/RealtimeSync";
import { OwnerVenuesProvider } from "@/features/venues/OwnerVenues";
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
import { LocalePage } from "./pages/Locale";
import { LocaleNuovoPage } from "./pages/LocaleNuovo";
import { LocaleDettaglioPage } from "./pages/LocaleDettaglio";
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

  // La dashboard è uno strumento da scrivania per chi gestisce un locale. Il
  // professionista non ha nulla da farci: schermata esplicita, non un redirect
  // silenzioso che lo lascerebbe a chiedersi cosa è andato storto.
  if (profile && profile.role !== "manager") return <NotForWaitersPage />;
  if (!profile) return <Spinner label="Caricamento profilo…" />;

  return (
    // Sopra tutto il resto: `RealtimeSync` deve sapere quali sedi ascoltare, e
    // `AppLayout` quante sono.
    <OwnerVenuesProvider>
      {/* Stesso listener dell'app: la dashboard si aggiorna sola quando il
          gestore tocca qualcosa dal telefono. */}
      <RealtimeSync userId={session.user.id} role={profile.role} />
      {/* RealtimeSync non copre la tabella `notifications`: ci pensa questo,
          come NotificationsListener sull'app. */}
      <NotificationsWatcher userId={session.user.id} />
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
          <Route path="/locale" element={<LocalePage />} />
          <Route path="/locale/nuovo" element={<LocaleNuovoPage />} />
          {/* Dopo "nuovo", o il match lo intercetterebbe come un id. */}
          <Route path="/locale/:id" element={<LocaleDettaglioPage />} />
          <Route path="/impostazioni" element={<ImpostazioniPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </OwnerVenuesProvider>
  );
}
