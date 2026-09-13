import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useActiveVenue } from "@/features/venues/ActiveVenue";
import { useChatUnreadCount } from "@/features/chat/hooks";
import { useUnreadCount } from "@/features/notifications/hooks";
import { cn } from "@/lib/cn";
import { Button, Placeholder, QueryError, Spinner } from "./ui/primitives";
import { VenueContext } from "./lib/venue";
import { VenueSwitcher } from "./VenueSwitcher";

type NavItem = { to: string; label: string; badge?: "chat" | "notifiche" };

const NAV: NavItem[] = [
  { to: "/", label: "Home" },
  { to: "/planning", label: "Planning" },
  { to: "/copertura", label: "Copertura" },
  { to: "/ore", label: "Ore" },
  { to: "/staff", label: "Staff" },
  { to: "/storico", label: "Storico" },
  { to: "/chat", label: "Messaggi", badge: "chat" },
  { to: "/notifiche", label: "Notifiche", badge: "notifiche" },
  { to: "/locale", label: "Locale" },
  { to: "/impostazioni", label: "Impostazioni" },
];

export function AppLayout() {
  // `profile` non serve più qui: l'identità dell'utente la mostra VenueSwitcher,
  // che è anche il posto da cui si cambia sede.
  const { session, signOut } = useAuth();
  const { venue, isPending, isError, error } = useActiveVenue();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // Aggiornati in tempo reale da RealtimeSync (invalida chat.unreadAll) e dal
  // canale notifications.
  const chatUnread = useChatUnreadCount(session!.user.id).data ?? 0;
  const notifUnread = useUnreadCount(session!.user.id).data ?? 0;

  // Da "Locale" (e da "/locale/nuovo") si crea un locale, e "Impostazioni" deve
  // restare raggiungibile comunque (uscire, cancellare l'account): passano il
  // gate anche senza nessuna sede.
  const VENUE_FREE = ["/locale", "/locale/nuovo", "/impostazioni"];
  const needsVenue = !venue && !VENUE_FREE.includes(pathname);

  return (
    <div className="flex min-h-dvh">
      {/* Navigazione: sul foglio non serve, e ruberebbe un quarto di pagina. */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-border-2 bg-bg-card p-4 print:hidden">
        <VenueSwitcher />

        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const count =
              item.badge === "chat"
                ? chatUnread
                : item.badge === "notifiche"
                  ? notifUnread
                  : 0;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                // `end` solo sulla Home: senza, "/" resterebbe attiva ovunque.
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "focus-gold flex items-center justify-between rounded-xl px-3 py-2 text-sm font-medium transition",
                    isActive
                      ? "bg-gold/15 text-gold"
                      : "text-t2 hover:bg-bg-2 hover:text-t1"
                  )
                }
              >
                {item.label}
                {count > 0 ? (
                  <span className="rounded-full bg-gold px-1.5 text-[11px] font-bold text-gold-ink">
                    {count > 9 ? "9+" : count}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>

        <div className="mt-auto pt-4">
          <Button className="w-full" onClick={() => void signOut()}>
            Esci
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-8 print:p-0">
        {isPending ? (
          <Spinner />
        ) : isError ? (
          <QueryError error={error} />
        ) : needsVenue ? (
          // Senza locale non esiste nulla da gestire: ogni query di questa
          // dashboard è ancorata a venue_id.
          <Placeholder
            title="Nessun locale collegato a questo account"
            detail="Crea il locale per iniziare a programmare i turni."
            action={
              <Button variant="gold" onClick={() => navigate("/locale/nuovo")}>
                Crea il locale
              </Button>
            }
          />
        ) : (
          <VenueContext.Provider value={venue}>
            {/* Solo in stampa: senza la sidebar il foglio sarebbe anonimo, e un
                turnario appeso in bacheca deve dire di chi è e di quando. */}
            <div className="mb-4 hidden items-baseline justify-between gap-4 border-b border-border-2 pb-2 print:flex">
              <span className="font-serif text-base text-t1">
                {venue?.name}
              </span>
              <span className="font-mono text-xs text-t3">
                stampato il {new Date().toLocaleDateString("it-IT")}
              </span>
            </div>
            <Outlet />
          </VenueContext.Provider>
        )}
      </main>
    </div>
  );
}
