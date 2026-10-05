import type { PropsWithChildren } from "react";
import { cn } from "@/lib/cn";

/** Forme decorative: l'annuncio di caricamento appartiene alla regione. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block h-3 rounded-md bg-bg-3 motion-safe:animate-pulse",
        className,
      )}
    />
  );
}

export function LoadingRegion({
  children,
  label = "Caricamento…",
  className,
}: PropsWithChildren<{ label?: string; className?: string }>) {
  return (
    <div role="status" aria-label={label} className={className}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

export function ListSkeleton({
  rows = 4,
  avatar = false,
  label,
  className,
}: {
  rows?: number;
  avatar?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <LoadingRegion label={label} className={className}>
      <div className="flex flex-col gap-2">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-2xl border border-border-2 bg-bg-card p-4"
          >
            {avatar ? <Skeleton className="size-9 shrink-0 rounded-full" /> : null}
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className={i % 2 ? "h-4 w-2/5" : "h-4 w-3/5"} />
              <Skeleton className="w-3/4 max-w-64" />
            </div>
            <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function TableSkeleton({
  columns = 5,
  rows = 6,
  label,
}: { columns?: number; rows?: number; label?: string }) {
  return (
    <LoadingRegion label={label}>
      <div className="overflow-x-auto rounded-2xl border border-border-2 bg-bg-card">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border-2">
              {Array.from({ length: columns }, (_, i) => (
                <th key={i} className="px-5 py-3">
                  <Skeleton className="w-16" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                {Array.from({ length: columns }, (_, j) => (
                  <td key={j} className="px-5 py-4">
                    <Skeleton className={j === 0 ? "h-4 w-28" : "h-4 w-16"} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LoadingRegion>
  );
}

export function DetailSkeleton() {
  return (
    <LoadingRegion label="Caricamento dettagli…">
      <div className="space-y-6 rounded-2xl border border-border-2 bg-bg-card p-5">
        <div className="flex items-center gap-3">
          <Skeleton className="size-12 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-2/5" />
            <Skeleton className="w-1/3" />
          </div>
        </div>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="w-24" />
            <Skeleton className="h-10 w-full rounded-xl bg-bg-2" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function PlanningSkeleton({
  view = "settimana",
  days = 35,
}: { view?: "settimana" | "persone" | "mese"; days?: number }) {
  if (view === "persone") {
    return <TableSkeleton columns={8} label="Caricamento planning per persona…" />;
  }
  return (
    <LoadingRegion label="Caricamento planning…">
      <div className="grid grid-cols-7 overflow-hidden rounded-2xl border border-border-2 bg-bg-card">
        {Array.from({ length: view === "mese" ? days : 7 }, (_, i) => (
          <div
            key={i}
            className={cn(
              "min-w-0 border-b border-r border-border p-3",
              view === "mese" ? "min-h-32" : "min-h-80",
            )}
          >
            <Skeleton className="mb-5 w-2/5" />
            {i % 3 !== 2 ? <Skeleton className="h-16 w-full rounded-xl bg-bg-2" /> : null}
            {view === "settimana" && i % 2 === 0 ? <Skeleton className="mt-3 h-20 w-full rounded-xl bg-bg-2" /> : null}
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function ChatSkeleton() {
  return (
    <div className="grid h-[calc(100dvh-12rem)] grid-cols-[20rem_1fr] gap-6">
      <ListSkeleton avatar label="Caricamento conversazioni…" />
      <div className="rounded-2xl border border-border-2 bg-bg-card p-5">
        <MessageSkeleton />
      </div>
    </div>
  );
}

export function MessageSkeleton() {
  return (
    <LoadingRegion label="Caricamento messaggi…">
      <div className="flex flex-col gap-4">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton
            key={i}
            className={cn("h-16 w-3/5 rounded-2xl bg-bg-2", i % 2 && "self-end")}
          />
        ))}
      </div>
    </LoadingRegion>
  );
}

/** Il contesto sta arrivando: nessun menu attivo prima di conoscere i permessi. */
export function DashboardSkeleton() {
  return (
    <div className="flex min-h-dvh">
      <LoadingRegion
        label="Caricamento azienda…"
        className="h-dvh w-60 shrink-0 border-r border-border-2 bg-bg-card p-6"
      >
        <Skeleton className="mb-4 h-1 w-8 bg-gold/40" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="mb-10 mt-3 w-1/2" />
        <div className="space-y-5">
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-6 w-full" />)}
        </div>
      </LoadingRegion>
      <main className="min-w-0 flex-1 p-8">
        <LoadingRegion className="mb-6">
          <Skeleton className="h-8 w-48" />
        </LoadingRegion>
        <div className="mb-6 grid grid-cols-2 gap-3">
          {[0, 1].map((i) => (
            <LoadingRegion key={i} className="rounded-2xl border border-border-2 bg-bg-card p-4">
              <Skeleton className="h-9 w-12" />
              <Skeleton className="mt-3 w-28" />
              <Skeleton className="mt-2 w-40" />
            </LoadingRegion>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-6">
          <ListSkeleton avatar />
          <ListSkeleton />
        </div>
      </main>
    </div>
  );
}
