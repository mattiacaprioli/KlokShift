import type { PropsWithChildren, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AdminFlag, AdminPage } from "@/features/admin/types";
import { cn } from "@/lib/cn";
import { Avatar } from "../ui/Avatar";
import { SidebarIcon, type SidebarIconName } from "../ui/SidebarIcon";
import { date, flagLabels, labels, severityTone, stateTone, time, type Tone } from "./format";

export { Meter } from "../ui/Meter";

/*
 * Pezzi visivi dell'area fondatore. Solo presentazione: nessuno legge dati o
 * decide regole, così il colore di uno stato è lo stesso in ogni pagina.
 */

export const Icon = SidebarIcon;
export type IconName = SidebarIconName;

const dotClass: Record<Tone, string> = {
  neutral: "bg-t4", gold: "bg-gold", success: "bg-success", warning: "bg-warning", error: "bg-error",
};
const edgeClass: Record<Tone, string> = {
  neutral: "border-l-border-2", gold: "border-l-gold", success: "border-l-success", warning: "border-l-warning", error: "border-l-error",
};
const softClass: Record<Tone, string> = {
  neutral: "bg-bg-3 text-t2", gold: "bg-gold/12 text-gold", success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning", error: "bg-error/12 text-error",
};

export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", dotClass[tone], className)} />;
}

/** Pallino + etichetta: lo stato si legge anche senza colore. */
export function StateBadge({ state, label }: { state: string; label?: string }) {
  const tone = stateTone[state] ?? "neutral";
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-t1">
    <Dot tone={tone} className={tone === "success" ? "shadow-[0_0_0_3px] shadow-success/20" : undefined} />
    {label ?? labels[state] ?? state}
  </span>;
}

export function Chip({ tone = "neutral", icon, children, title }: PropsWithChildren<{ tone?: Tone; icon?: IconName; title?: string }>) {
  return <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", softClass[tone])}>
    {icon ? <Icon name={icon} className="size-3" /> : null}{children}
  </span>;
}

export function Monogram({ name, size = 36 }: { name: string; size?: number }) {
  return <Avatar url={null} name={name} size={size} />;
}

/** Quadratino con icona, per testate e card. */
export function IconBadge({ icon, tone = "gold", className }: { icon: IconName; tone?: Tone; className?: string }) {
  return <span aria-hidden className={cn("grid size-9 shrink-0 place-items-center rounded-xl", softClass[tone], className)}>
    <Icon name={icon} className="size-[18px]" />
  </span>;
}

export function StatTile({ icon, label, value, children }: PropsWithChildren<{ icon: IconName; label: string; value: ReactNode }>) {
  return <div className="relative overflow-hidden rounded-2xl border border-border-2 bg-bg-card p-5">
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-t3">{label}</p>
      <IconBadge icon={icon} tone="neutral" className="size-8" />
    </div>
    <p className="mt-3 font-serif text-4xl leading-none tabular-nums text-t1">{value}</p>
    {children ? <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-t3">{children}</div> : null}
  </div>;
}

/** Una voce di dettaglio di `StatTile`: pallino, numero, parola. */
export function StatPart({ tone = "neutral", value, label }: { tone?: Tone; value: ReactNode; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><Dot tone={tone} /><span className="font-semibold tabular-nums text-t2">{value}</span>{label}</span>;
}

/** Barre orizzontali proporzionali al massimo: una sola serie, niente legenda. */
export function BarList({ items }: { items: { key: string; label: string; value: number; tone?: Tone }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="text-sm text-t3">Nessun dato.</p>;
  return <ul className="space-y-2.5">{items.map((i) => <li key={i.key} title={`${i.label}: ${i.value}`}>
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="flex min-w-0 items-center gap-2 text-t2">{i.tone ? <Dot tone={i.tone} /> : null}<span className="truncate">{i.label}</span></span>
      <span className="font-semibold tabular-nums text-t1">{i.value}</span>
    </div>
    <div className="mt-1 h-1.5 rounded-full bg-bg-2">
      <div className={cn("h-full rounded-full", i.value === 0 ? "" : i.tone ? dotClass[i.tone] : "bg-gold/70")}
        style={{ width: `${(i.value / max) * 100}%` }} />
    </div>
  </li>)}</ul>;
}

export function SectionHeader({ title, icon, count, tone = "warning", action, className }: {
  title: string; icon?: IconName; count?: ReactNode; tone?: Tone; action?: ReactNode; className?: string;
}) {
  return <div className={cn("mb-4 flex flex-wrap items-center gap-3", className)}>
    {icon ? <IconBadge icon={icon} tone="neutral" className="size-8" /> : null}
    <h2 className="font-semibold text-t1">{title}</h2>
    {count ? <Chip tone={tone}>{count}</Chip> : null}
    {action ? <div className="ml-auto">{action}</div> : null}
  </div>;
}

/** Un blocco «da fare» senza voci: una riga, non una card vuota. */
export function AllClear({ icon, title, children }: PropsWithChildren<{ icon: IconName; title: string }>) {
  return <div className="flex items-center gap-4 rounded-2xl border border-border-2 bg-bg-card px-5 py-4">
    <IconBadge icon={icon} tone="neutral" className="size-8" />
    <div className="min-w-0 flex-1">
      <h2 className="text-sm font-semibold text-t1">{title}</h2>
      <p className="text-xs text-t3">{children}</p>
    </div>
    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-success/12 text-success" aria-label="Tutto in ordine">
      <Icon name="check" className="size-4" />
    </span>
  </div>;
}

/** Voce da gestire: bordo sinistro del colore della gravità. */
export function AttentionItem({ tone, children }: PropsWithChildren<{ tone: Tone }>) {
  return <li className={cn("rounded-xl border border-border-2 border-l-[3px] bg-bg-1 p-4", edgeClass[tone])}>{children}</li>;
}

/** Il riquadro «cosa fare» di una voce da gestire. */
export function ActionBox({ children }: PropsWithChildren) {
  return <div className="mt-3 rounded-xl bg-bg-2/70 p-3">{children}</div>;
}

export function FlagItem({ flag, workspace }: { flag: AdminFlag; workspace?: { id: string; name: string } }) {
  const tone = severityTone[flag.severity];
  return <li className={cn("rounded-xl border border-border-2 border-l-[3px] bg-bg-1 px-4 py-3", edgeClass[tone])}>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {workspace ? <Link className="focus-gold rounded font-semibold text-t1 hover:text-gold" to={`/amministrazione/aziende/${workspace.id}`}>{workspace.name}</Link> : null}
      <span className="inline-flex items-center gap-1.5 text-sm text-t2">
        <Icon name={flag.severity === "info" ? "activity" : "alert"} className={cn("size-3.5", flag.severity === "critical" ? "text-error" : flag.severity === "warning" ? "text-warning" : "text-t3")} />
        {flagLabels[flag.code]}
      </span>
    </div>
    <p className="mt-1 text-xs text-t4">Fonte: {flag.source}{flag.at ? ` · ${date(flag.at)}` : ""}</p>
  </li>;
}

export function FlagList({ flags }: { flags: AdminFlag[] }) {
  return flags.length ? <ul className="space-y-2">{flags.map((f) => <FlagItem key={f.code} flag={f} />)}</ul>
    : <p className="flex items-center gap-2 text-sm text-t3"><Icon name="check" className="size-4 text-success" />Nessuna anomalia fra i controlli disponibili.</p>;
}

/** Al posto del paragrafo ripetuto: l'ora della lettura, il resto nel title. */
export function SnapshotChip({ at }: { at: string }) {
  return <span title={`Dati verificati dal server: ${date(at)} · orario Europe/Rome. Usa Aggiorna per una nuova lettura.`}
    className="inline-flex items-center gap-1.5 rounded-full border border-border-2 px-2.5 py-1 text-xs text-t3">
    <Dot tone="success" />Dati verificati alle {time(at)}
  </span>;
}

export function Pager({ page, onOffset }: { page: AdminPage; onOffset: (n: number) => void }) {
  if (page.total <= page.limit && page.offset === 0) return null;
  return <div className="mt-4 flex items-center justify-between gap-3 text-xs text-t3">
    <span className="tabular-nums">{page.total === 0 ? "Nessun risultato" : page.offset >= page.total ? `Pagina vuota · ${page.total} risultati totali`
      : `${page.offset + 1}–${Math.min(page.offset + page.limit, page.total)} di ${page.total}`}</span>
    <div className="flex gap-1">
      <PagerButton label="Precedenti" icon="chevronLeft" disabled={page.offset === 0} onClick={() => onOffset(Math.max(0, page.offset - page.limit))} />
      <PagerButton label="Successivi" icon="chevronRight" disabled={page.offset + page.limit >= page.total} onClick={() => onOffset(page.offset + page.limit)} />
    </div>
  </div>;
}
function PagerButton({ label, icon, disabled, onClick }: { label: string; icon: IconName; disabled: boolean; onClick: () => void }) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
    className="focus-gold grid size-8 cursor-pointer place-items-center rounded-lg border border-border-2 bg-bg-2 text-t2 transition hover:bg-bg-3 hover:text-t1 disabled:cursor-not-allowed disabled:opacity-30">
    <Icon name={icon} className="size-4" />
  </button>;
}

/** Elenco verticale con pallini: storico dei periodi e registro interventi. */
export function Timeline({ children }: PropsWithChildren) {
  return <ol className="relative space-y-5 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-border-2">{children}</ol>;
}
export function TimelineItem({ tone = "neutral", children }: PropsWithChildren<{ tone?: Tone }>) {
  return <li className="relative pl-7">
    <span aria-hidden className="absolute left-0 top-1 grid size-[15px] place-items-center rounded-full bg-bg-card">
      <span className={cn("size-[9px] rounded-full", dotClass[tone])} />
    </span>
    {children}
  </li>;
}

/** Griglia etichetta → valore, per le testate delle schede. */
export function Facts({ items }: { items: { label: string; value: ReactNode; title?: string }[] }) {
  return <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{items.map((i) => <div key={i.label} className="rounded-xl bg-bg-1 px-4 py-3" title={i.title}>
    <dt className="text-xs text-t3">{i.label}</dt>
    <dd className="mt-1 text-sm text-t1">{i.value}</dd>
  </div>)}</dl>;
}

/** Nota di lettura: spiegazioni che servono, ma non devono gridare. */
export function Footnote({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <p className={cn("text-xs leading-relaxed text-t4", className)}>{children}</p>;
}

/** Card con bordo rosso tenue per le operazioni che non si annullano. */
export function DangerZone({ children }: PropsWithChildren) {
  return <div className="rounded-2xl border border-error/30 bg-error/[0.04] p-5">{children}</div>;
}

/** Scheltro di caricamento di una card. */
export function CardSkeleton({ title, rows = 3 }: { title: string; rows?: number }) {
  return <div className="rounded-2xl border border-border-2 bg-bg-card p-5" aria-busy="true">
    <h2 className="mb-4 font-semibold text-t1">{title}</h2>
    <div className="space-y-3">{Array.from({ length: rows }, (_, i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-bg-2" />)}</div>
    <span className="sr-only">Caricamento…</span>
  </div>;
}
