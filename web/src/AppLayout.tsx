import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import type { TeamPermission } from "@/features/team/api";
import { companyName } from "@/features/venues/companyName";
import { useChatUnreadCount } from "@/features/chat/hooks";
import { useUnreadCount } from "@/features/notifications/hooks";
import { usePendingAbsenceCount } from "@/features/absences/hooks";
import { cn } from "@/lib/cn";
import { QueryError, Spinner } from "./ui/primitives";
import { Avatar } from "./ui/Avatar";
import { PersonAvatarProvider } from "./ui/PersonAvatar";
import { SidebarIcon, type SidebarIconName } from "./ui/SidebarIcon";

type NavItem = {
  to: string;
  label: string;
  icon: SidebarIconName;
  group: "Operatività" | "Persone" | "Gestione";
  badge?: "chat" | "notifiche" | "assenze";
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
  { to: "/", label: "Home", icon: "home", group: "Operatività" },
  { to: "/planning", label: "Planning", icon: "planning", group: "Operatività" },
  { to: "/ore", label: "Ore", icon: "hours", group: "Operatività", perm: "can_view_hours" },
  { to: "/staff", label: "Staff", icon: "staff", group: "Persone", perm: "can_manage_staff" },
  // Stesso permesso di Staff: è quello che fa leggere e decidere le assenze.
  {
    to: "/assenze",
    label: "Assenze", icon: "absence", group: "Operatività",
    perm: "can_manage_staff",
    badge: "assenze",
  },
  { to: "/storico", label: "Storico", icon: "history", group: "Operatività" },
  // Per tutti: dal 20/09 una conversazione è fra due persone qualsiasi della
  // stessa azienda, e la RLS fa leggere a ciascuno solo le proprie. Chi può
  // scrivere a chi lo decidono la rubrica e `open_conversation`.
  { to: "/chat", label: "Messaggi", icon: "chat", group: "Persone", badge: "chat" },
  { to: "/notifiche", label: "Notifiche", icon: "notifications", group: "Persone", badge: "notifiche" },
  { to: "/sede", label: "Sede", icon: "venue", group: "Gestione" },
  { to: "/collaboratori", label: "Collaboratori", icon: "team", group: "Gestione", ownerOnly: true },
  { to: "/impostazioni", label: "Impostazioni", icon: "settings", group: "Gestione" },
];

export function AppLayout() {
  const { session, profile, signOut } = useAuth();
  const { venues, isPending, isError, error, isOwner, canAny } =
    useOwnerVenues();
  // Aggiornati in tempo reale da RealtimeSync (invalida chat.unreadAll) e dal
  // canale notifications.
  const chatUnread = useChatUnreadCount(session!.user.id).data ?? 0;
  const notifUnread = useUnreadCount(session!.user.id).data ?? 0;
  // Le richieste da decidere: stessa query del blocco «Richieste» della Home.
  const absencesPending = usePendingAbsenceCount(canAny("can_manage_staff"));

  // L'**azienda**, non la sede: la dashboard le guarda tutte insieme, e fino al
  // 14/09/2026 questa riga era uno switcher perché ne guardava una alla volta.
  const company = companyName(venues, profile?.full_name);
  const who = profile?.full_name ?? session?.user.email;

  return (
    <div className="flex min-h-dvh">
      {/* Intestazione e account restano visibili anche quando il menu scorre. */}
      <aside className="sticky top-0 flex h-dvh w-60 shrink-0 flex-col border-r border-border-2 bg-bg-card print:hidden">
        <div className="shrink-0 px-6 pb-5 pt-6">
          <div className="mb-4 h-1 w-8 rounded-full bg-gold" />
          <p className="break-words font-serif text-xl leading-tight text-t1">{company}</p>
          <p className="mt-2 text-xs text-t2">
            {venues.length > 1 ? `${venues.length} sedi` : "Gestione turni"}
          </p>
        </div>

        <nav aria-label="Navigazione principale" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-6">
          {(["Operatività", "Persone", "Gestione"] as const).map((group) => {
            const items = NAV.filter(
              (item) => item.group === group &&
                (!item.ownerOnly || isOwner) && (!item.perm || canAny(item.perm))
            );
            if (items.length === 0) return null;
            return (
              <div key={group}>
                <h2 className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-t3">
                  {group}
                </h2>
                <div className="space-y-1">
                  {items.map((item) => {
                    const count =
                      item.badge === "chat" ? chatUnread :
                      item.badge === "notifiche" ? notifUnread :
                      item.badge === "assenze" ? absencesPending : 0;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === "/"}
                        className={({ isActive }) => cn(
                          "focus-gold flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-medium transition-colors",
                          isActive ? "bg-gold/12 text-gold" : "text-t2 hover:bg-bg-2 hover:text-t1"
                        )}
                      >
                        <SidebarIcon name={item.icon} />
                        <span className="flex-1">{item.label}</span>
                        {count > 0 ? (
                          <span
                            aria-label={`${count} ${item.badge === "assenze" ? "richieste da gestire" : item.badge === "chat" ? "messaggi non letti" : "notifiche non lette"}`}
                            className="flex min-w-5 items-center justify-center rounded-full bg-gold px-1.5 py-0.5 text-[10px] font-bold leading-4 text-gold-ink"
                          >
                            {count > 99 ? "99+" : count}
                          </span>
                        ) : null}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-border-2 p-3">
          <Link
            to="/impostazioni"
            aria-label="Apri le impostazioni del tuo account"
            className="focus-gold flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-bg-2"
          >
            <Avatar url={profile?.avatar_url} name={who ?? "Profilo"} size={36} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-t1" title={who}>{who}</p>
              <p className="mt-0.5 text-xs text-t3">Il tuo account</p>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => void signOut()}
            className="focus-gold mt-1 flex min-h-9 w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-xs text-t2 transition-colors hover:bg-bg-2 hover:text-t1"
          >
            <SidebarIcon name="logout" />
            Esci
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-8 print:p-0">
        {/* Niente più gate "serve una sede": ogni pagina mostra il proprio stato
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
            <PersonAvatarProvider><Outlet /></PersonAvatarProvider>
          </>
        )}
      </main>
    </div>
  );
}
