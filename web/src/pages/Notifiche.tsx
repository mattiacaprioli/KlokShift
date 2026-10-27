import { useMemo, useState } from "react";
import type { Enums } from "@/types/database";
import { ListSkeleton } from "../ui/Skeleton";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from "@/features/notifications/hooks";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/cn";
import { webRouteForNotification } from "../lib/notificationRoute";
import { Avatar } from "../ui/Avatar";
import { NotificationIcon } from "../ui/NotificationIcon";
import {
  Button,
  Card,
  PageColumns,
  PageHeader,
  Placeholder,
  QueryError,
} from "../ui/primitives";

type Category = "all" | "messages" | "shifts" | "absences" | "team";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "all", label: "Tutte" },
  { id: "messages", label: "Messaggi" },
  { id: "shifts", label: "Turni" },
  { id: "absences", label: "Assenze" },
  { id: "team", label: "Squadra e azienda" },
];

/** Lo stesso raggruppamento dell'icona: messaggi, turni, assenze, il resto. */
function categoryOf(type: Enums<"notification_type">): Exclude<Category, "all"> {
  if (type === "new_message") return "messages";
  if (type.startsWith("shift_") || type === "clock_reminder") return "shifts";
  if (type.startsWith("absence_")) return "absences";
  return "team";
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** «Oggi», «Ieri», poi il giorno per esteso. */
function dayLabel(value: string, today: Date) {
  const d = new Date(value);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return "Oggi";
  if (dayKey(d) === dayKey(yesterday)) return "Ieri";
  return d.toLocaleDateString("it-IT", {
    weekday: "long", day: "numeric", month: "long",
    ...(d.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

export function NotifichePage() {
  const { session } = useAuth();
  const userId = session!.user.id;
  const navigate = useNavigate();
  const query = useNotifications(userId);
  const unreadQuery = useUnreadCount(userId);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead(userId);
  const [category, setCategory] = useState<Category>("all");
  // Fermo al montaggio: «Oggi» e «Ieri» non cambiano mentre la pagina è aperta.
  const [today] = useState(() => new Date());

  const items = useMemo(() => query.data ?? [], [query.data]);
  const counts = useMemo(() => {
    const c: Record<Category, number> = { all: items.length, messages: 0, shifts: 0, absences: 0, team: 0 };
    for (const n of items) c[categoryOf(n.type)] += 1;
    return c;
  }, [items]);
  const groups = useMemo(() => {
    const out: { label: string; items: typeof items }[] = [];
    for (const n of items) {
      if (category !== "all" && categoryOf(n.type) !== category) continue;
      const label = dayLabel(n.created_at, today);
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  }, [items, category, today]);

  if (query.isPending) {
    return (
      <>
        <PageHeader title="Notifiche" />
        <ListSkeleton avatar label="Caricamento notifiche…" className="max-w-7xl" />
      </>
    );
  }
  if (query.isError) return <QueryError error={query.error} />;

  const unread = unreadQuery.data ?? 0;
  const markAllButton = (
    <Button onClick={() => markAll.mutate()} disabled={markAll.isPending}>
      Segna tutte come lette
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Notifiche"
        subtitle={unread > 0 ? `${unread} da leggere` : "Tutto letto"}
        // Su schermo largo il comando sta nella colonna a destra.
        actions={unread > 0 ? <div className="xl:hidden">{markAllButton}</div> : undefined}
      />

      {items.length === 0 ? (
        <Placeholder
          title="Nessuna notifica"
          detail="Risposte dello staff, aggiornamenti dei turni e messaggi arrivano qui."
        />
      ) : (
        <PageColumns
          aside={
            <>
              <Card>
                <p className="text-sm text-t3">Da leggere</p>
                <p className={cn("mt-1 font-serif text-4xl tabular-nums", unread > 0 ? "text-gold" : "text-t1")}>
                  {unread}
                </p>
                {unread > 0 ? (
                  <div className="mt-4">{markAllButton}</div>
                ) : (
                  <p className="mt-2 text-sm text-t3">Tutto letto.</p>
                )}
              </Card>
              <Card className="p-3">
                <h2 className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-t3">
                  Per tipo
                </h2>
                <div role="group" aria-label="Tipo di notifica" className="flex flex-col gap-1">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={category === c.id}
                      onClick={() => setCategory(c.id)}
                      className={cn(
                        "focus-gold flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition",
                        category === c.id ? "bg-gold/12 font-semibold text-gold" : "text-t2 hover:bg-bg-2 hover:text-t1"
                      )}
                    >
                      {c.label}
                      <span className="text-xs tabular-nums text-t3">{counts[c.id]}</span>
                    </button>
                  ))}
                </div>
                {query.hasNextPage ? (
                  <p className="px-2 pt-3 text-xs text-t4">Conteggi sulle notifiche già caricate.</p>
                ) : null}
              </Card>
            </>
          }
        >
          {groups.length === 0 ? (
            <Placeholder
              title="Nessuna notifica di questo tipo"
              detail="Fra quelle caricate non ce ne sono: prova «Tutte» o carica le precedenti."
            />
          ) : (
            groups.map((g) => (
              <section key={g.label} className="flex flex-col gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-t3 first-letter:uppercase">
                  {g.label}
                </h2>
                {g.items.map((n) => {
                  const route = webRouteForNotification(n.type, n.related_id);
                  const isUnread = !n.read_at;
                  return (
                    <button
                      key={n.id}
                      disabled={!route}
                      onClick={() => {
                        if (isUnread) markRead.mutate(n.id);
                        if (route) navigate(route);
                      }}
                      className={cn(
                        "focus-gold flex items-center gap-3 rounded-2xl border p-4 text-left transition",
                        isUnread
                          ? "border-border-gold bg-gold/5"
                          : "border-border-2 bg-bg-card",
                        route ? "hover:bg-bg-1" : "cursor-default"
                      )}
                    >
                      {n.person ? (
                        <Avatar url={n.person.profile?.avatar_url} name={n.person.display_name} size={40} />
                      ) : (
                        <NotificationIcon type={n.type} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p
                            className={cn(
                              "text-sm",
                              isUnread ? "font-semibold text-t1" : "text-t2"
                            )}
                          >
                            {n.title}
                          </p>
                          <span className="shrink-0 text-xs text-t4">
                            {timeAgo(n.created_at)}
                          </span>
                        </div>
                        {n.body ? (
                          <p className="mt-1 text-xs leading-5 text-t3">{n.body}</p>
                        ) : null}
                      </div>
                      {isUnread ? <span aria-label="Da leggere" className="size-2 shrink-0 rounded-full bg-gold" /> : null}
                    </button>
                  );
                })}
              </section>
            ))
          )}
          {query.hasNextPage ? (
            <Button
              onClick={() => query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
              className="self-center"
            >
              {query.isFetchingNextPage ? "Caricamento…" : "Carica altre"}
            </Button>
          ) : null}
        </PageColumns>
      )}
    </>
  );
}
