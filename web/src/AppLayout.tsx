import { useState } from "react";
import { DetailSkeleton } from "./ui/Skeleton";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import type { TeamPermission } from "@/features/team/api";
import { companyName } from "@/features/venues/companyName";
import { useChatUnreadCount } from "@/features/chat/hooks";
import { useUnreadCount } from "@/features/notifications/hooks";
import { usePendingAbsenceCount } from "@/features/absences/hooks";
import { cn } from "@/lib/cn";
import { QueryError } from "./ui/primitives";
import { Avatar } from "./ui/Avatar";
import { PersonAvatarProvider } from "./ui/PersonAvatar";
import { SidebarIcon, type SidebarIconName } from "./ui/SidebarIcon";
import { AccessBanner } from "./billing/AccessBanner";

type NavItem = {
  to: string;
  label: string;
  icon: SidebarIconName;
  group: "Ogni giorno" | "Persone" | "Gestione";
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
  { to: "/", label: "Home", icon: "home", group: "Ogni giorno" },
  { to: "/planning", label: "Turni", icon: "planning", group: "Ogni giorno" },
  { to: "/ore", label: "Ore", icon: "hours", group: "Ogni giorno", perm: "can_view_hours" },
  { to: "/staff", label: "Team", icon: "staff", group: "Persone", perm: "can_manage_staff" },
  // «Ruoli» non è nel menu (scelta del 22/10): ci si arriva dal pulsante in
  // Staff, dai «Primi passi» e dal form del turno.
  // Stesso permesso di Staff: è quello che fa leggere e decidere le assenze.
  {
    to: "/assenze",
    label: "Assenze", icon: "absence", group: "Ogni giorno",
    perm: "can_manage_staff",
    badge: "assenze",
  },
  { to: "/storico", label: "Storico", icon: "history", group: "Ogni giorno" },
  // Per tutti: dal 20/09 una conversazione è fra due persone qualsiasi della
  // stessa azienda, e la RLS fa leggere a ciascuno solo le proprie. Chi può
  // scrivere a chi lo decidono la rubrica e `open_conversation`.
  { to: "/chat", label: "Messaggi", icon: "chat", group: "Persone", badge: "chat" },
  { to: "/notifiche", label: "Notifiche", icon: "notifications", group: "Persone", badge: "notifiche" },
  { to: "/sede", label: "Sede", icon: "venue", group: "Gestione" },
  { to: "/collaboratori", label: "Collaboratori", icon: "team", group: "Gestione", ownerOnly: true },
  { to: "/piano", label: "Piano e accesso", icon: "plan", group: "Gestione", ownerOnly: true },
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

  const [collapsed, setCollapsed] = useState(readCollapsed);
  function toggle() {
    setCollapsed((c) => {
      writeCollapsed(!c);
      return !c;
    });
  }

  // Ristretta: solo icone. Aperta o chiusa la struttura è la stessa e le icone
  // non si spostano: cambia la larghezza, le scritte sfumano e vengono tagliate
  // dal bordo. Così il movimento è uno solo, senza salti a fine animazione.
  const ease = "duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";
  const fade = cn("transition-opacity", ease, collapsed ? "opacity-0" : "opacity-100");
  const itemClass = (isActive: boolean) => cn(
    "focus-gold relative flex min-h-9 items-center gap-3 rounded-lg px-[13px] py-1.5 text-sm font-medium transition-colors",
    isActive ? "bg-gold/12 text-gold" : "text-t2 hover:bg-bg-2 hover:text-t1"
  );
  const footClass = (isActive = false) => cn(
    "focus-gold mt-1 flex min-h-8 w-full cursor-pointer items-center gap-3 rounded-lg px-[13px] py-1.5 text-left text-xs transition-colors",
    isActive ? "bg-gold/12 text-gold" : "text-t2 hover:bg-bg-2 hover:text-t1"
  );
  const label = (text: string) => <span className={cn("flex-1 whitespace-nowrap", fade)}>{text}</span>;

  return (
    <div className="flex min-h-dvh">
      {/* Intestazione e account restano visibili anche quando il menu scorre. */}
      <aside
        className={cn(
          "sticky top-0 flex h-dvh shrink-0 flex-col overflow-hidden border-r border-border-2 bg-bg-card transition-[width] print:hidden",
          ease,
          collapsed ? "w-[68px]" : "w-60"
        )}
      >
        <div className={cn("shrink-0 pb-4 pt-6 transition-[padding]", ease, collapsed ? "px-5" : "px-6")}>
          <div className="flex h-7 items-center justify-between">
            <div
              title={company}
              className={cn("h-1 shrink-0 rounded-full bg-gold transition-[width,opacity]", ease, collapsed ? "w-0 opacity-0" : "w-8")}
            />
            <CollapseButton collapsed={collapsed} onClick={toggle} />
          </div>
          {/* Altezza da 1fr a 0fr: il blocco del nome si chiude senza far
              saltare il menu sotto. Larghezza fissa: il testo non va a capo
              mentre la colonna si stringe, viene solo tagliato. */}
          <div className={cn("grid transition-[grid-template-rows,opacity]", ease, collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100")}>
            <div className="overflow-hidden">
              <div className="w-48 pt-2">
                <p className="break-words font-serif text-xl leading-tight text-t1">{company}</p>
                <p className="mt-2 text-xs text-t2">
                  {venues.length > 1 ? `${venues.length} sedi` : "Gestione turni"}
                </p>
              </div>
            </div>
          </div>
        </div>

        <nav aria-label="Navigazione principale" className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 pb-6">
          {(["Ogni giorno", "Persone", "Gestione"] as const).map((group) => {
            const items = NAV.filter(
              (item) => item.group === group &&
                (!item.ownerOnly || isOwner) && (!item.perm || canAny(item.perm))
            );
            if (items.length === 0) return null;
            return (
              <div key={group}>
                {/* Stessa altezza aperta e chiusa: il titolo sfuma, al suo
                    posto compare una lineetta. */}
                <div className="relative mb-1 h-5">
                  <h2 className={cn("absolute inset-x-3 top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.14em] text-t3", fade)}>
                    {group}
                  </h2>
                  <div
                    aria-hidden
                    className={cn("absolute left-2 top-1/2 h-px w-7 bg-border-2 transition-opacity", ease, collapsed ? "opacity-100" : "opacity-0")}
                  />
                </div>
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const count =
                      item.badge === "chat" ? chatUnread :
                      item.badge === "notifiche" ? notifUnread :
                      item.badge === "assenze" ? absencesPending : 0;
                    const countLabel = `${count} ${item.badge === "assenze" ? "richieste da gestire" : item.badge === "chat" ? "messaggi non letti" : "notifiche non lette"}`;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === "/"}
                        title={collapsed ? (count > 0 ? `${item.label} · ${countLabel}` : item.label) : undefined}
                        className={({ isActive }) => itemClass(isActive)}
                      >
                        <SidebarIcon name={item.icon} />
                        {label(item.label)}
                        {count > 0 ? (
                          <>
                            <span
                              aria-label={countLabel}
                              className={cn("flex min-w-5 items-center justify-center rounded-full bg-gold px-1.5 py-0.5 text-[10px] font-bold leading-4 text-gold-ink", fade)}
                            >
                              {count > 99 ? "99+" : count}
                            </span>
                            <span
                              aria-hidden
                              className={cn("absolute left-[27px] top-1 size-2 rounded-full bg-gold ring-2 ring-bg-card transition-opacity", ease, collapsed ? "opacity-100" : "opacity-0")}
                            />
                          </>
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
          {/* L'unico ingresso a /impostazioni: fino al 22/10 c'era anche una
              voce «Impostazioni» in Gestione, che portava alla stessa pagina. */}
          <NavLink
            to="/impostazioni"
            aria-label="Apri account e impostazioni"
            title={collapsed ? `${who ?? "Profilo"} · Account e impostazioni` : undefined}
            className={({ isActive }) => cn(
              "focus-gold flex items-center gap-3 rounded-lg px-1 py-2 transition-colors",
              isActive ? "bg-gold/12" : "hover:bg-bg-2"
            )}
          >
            <Avatar url={profile?.avatar_url} name={who ?? "Profilo"} size={36} />
            <div className={cn("min-w-0 whitespace-nowrap", fade)}>
              <p className="truncate text-sm font-medium text-t1" title={who}>{who}</p>
              <p className="mt-0.5 text-xs text-t3">Account e impostazioni</p>
            </div>
          </NavLink>
          {/* Fuori da `NAV`: l'aiuto non dipende da nessun permesso. */}
          <NavLink
            to="/aiuto"
            title={collapsed ? "Aiuto e supporto" : undefined}
            className={({ isActive }) => footClass(isActive)}
          >
            <SidebarIcon name="help" />
            {label("Aiuto e supporto")}
          </NavLink>
          <button
            type="button"
            onClick={() => void signOut()}
            title={collapsed ? "Esci" : undefined}
            className={footClass()}
          >
            <SidebarIcon name="logout" />
            {label("Esci")}
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-8 print:p-0">
        {/* Niente più gate "serve una sede": ogni pagina mostra il proprio stato
            vuoto (`NoVenues`), perché nessuna è più ancorata a una sede sola. */}
        {isPending ? (
          <DetailSkeleton />
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
            <AccessBanner />
            <PersonAvatarProvider><Outlet /></PersonAvatarProvider>
          </>
        )}
      </main>
    </div>
  );
}

/** Restringe e riallarga la sidebar. */
function CollapseButton({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  const text = collapsed ? "Allarga il menu" : "Restringi il menu";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={text}
      aria-expanded={!collapsed}
      title={text}
      className="focus-gold grid size-7 cursor-pointer place-items-center rounded-lg text-t3 transition-colors hover:bg-bg-2 hover:text-t1"
    >
      <SidebarIcon name="panel" className="size-4" />
    </button>
  );
}

// Preferenza di questo browser: si legge e si scrive con try/catch perché in
// navigazione privata o con i dati del sito bloccati lo storage può lanciare.
const COLLAPSED_KEY = "klokshift.sidebar.collapsed";
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}
function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // Senza storage la scelta vale finché la pagina resta aperta.
  }
}
