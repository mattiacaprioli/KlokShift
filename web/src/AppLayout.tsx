import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import type { TeamPermission } from "@/features/team/api";
import { companyName } from "@/features/venues/companyName";
import { useChatUnreadCount } from "@/features/chat/hooks";
import { useUnreadCount } from "@/features/notifications/hooks";
import { cn } from "@/lib/cn";
import { Button, QueryError, Spinner } from "./ui/primitives";

type NavItem = {
  to: string;
  label: string;
  badge?: "chat" | "notifiche";
  /**
   * Il permesso che serve per arrivarci. Assente = per tutti (il titolare li ha
   * tutti, quindi vede sempre l'elenco intero).
   *
   * ⚠️ Nascondere una voce non è la difesa: un collaboratore che digita
   * `/ore` a mano ci arriva lo stesso, e trova la pagina vuota perché la RLS
   * non gli dà le righe. Qui si evita solo un menu pieno di vicoli ciechi.
   */
  perm?: TeamPermission;
  /** Solo il titolare. */
  ownerOnly?: boolean;
};

const NAV: NavItem[] = [
  { to: "/", label: "Home" },
  { to: "/planning", label: "Planning" },
  { to: "/ore", label: "Ore", perm: "can_view_hours" },
  { to: "/staff", label: "Staff", perm: "can_manage_staff" },
  { to: "/storico", label: "Storico" },
  { to: "/chat", label: "Messaggi", badge: "chat" },
  { to: "/notifiche", label: "Notifiche", badge: "notifiche" },
  { to: "/locale", label: "Locale" },
  { to: "/collaboratori", label: "Collaboratori", ownerOnly: true },
  { to: "/impostazioni", label: "Impostazioni" },
];

export function AppLayout() {
  const { session, profile, signOut } = useAuth();
  const { venues, isPending, isError, error, isOwner, canAny } =
    useOwnerVenues();
  // Aggiornati in tempo reale da RealtimeSync (invalida chat.unreadAll) e dal
  // canale notifications.
  const chatUnread = useChatUnreadCount(session!.user.id).data ?? 0;
  const notifUnread = useUnreadCount(session!.user.id).data ?? 0;

  // L'**azienda**, non la sede: la dashboard le guarda tutte insieme, e fino al
  // 14/09/2026 questa riga era uno switcher perché ne guardava una alla volta.
  const company = companyName(venues, profile?.full_name);
  const who = profile?.full_name ?? session?.user.email;

  return (
    <div className="flex min-h-dvh">
      {/* Navigazione: sul foglio non serve, e ruberebbe un quarto di pagina. */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-border-2 bg-bg-card p-4 print:hidden">
        <div className="mb-6 px-2">
          <div className="mb-3 h-1 w-8 rounded-full bg-gold" />
          <p className="font-serif text-lg leading-tight text-t1">{company}</p>
          <p className="mt-0.5 truncate text-xs text-t4">
            {venues.length > 1 ? `${venues.length} locali · ${who}` : who}
          </p>
        </div>

        <nav className="flex flex-col gap-0.5">
          {NAV.filter(
            (item) =>
              (!item.ownerOnly || isOwner) && (!item.perm || canAny(item.perm))
          ).map((item) => {
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
        {/* Niente più gate "serve un locale": ogni pagina mostra il proprio stato
            vuoto (`NoVenues`), perché nessuna è più ancorata a una sede sola. */}
        {isPending ? (
          <Spinner />
        ) : isError ? (
          <QueryError error={error} />
        ) : (
          <>
            {/* Solo in stampa: senza la sidebar il foglio sarebbe anonimo, e un
                turnario appeso in bacheca deve dire di chi è e di quando.
                L'azienda e non la sede: il turnario ora può contenerne più di una. */}
            <div className="mb-4 hidden items-baseline justify-between gap-4 border-b border-border-2 pb-2 print:flex">
              <span className="font-serif text-base text-t1">{company}</span>
              <span className="font-mono text-xs text-t3">
                stampato il {new Date().toLocaleDateString("it-IT")}
              </span>
            </div>
            <Outlet />
          </>
        )}
      </main>
    </div>
  );
}
