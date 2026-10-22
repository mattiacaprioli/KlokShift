import { cn } from "@/lib/cn";

/**
 * Usato su limite. Il riempimento dice la gravità (oro, arancio sopra l'80%,
 * rosso oltre il limite); senza limite resta il numero e basta.
 */
export function Meter({ label, used, limit, missing = "Non assegnato", unlimited, format = String, warnAt = 0.8 }: {
  label: string; used: number | null | undefined; limit: number | null | undefined;
  missing?: string; unlimited?: boolean; format?: (n: number) => string;
  /** Da quale quota l'arancio; con 1 mai (il cliente al limite pieno non sbaglia niente), rosso solo oltre. */
  warnAt?: number;
}) {
  const ratio = used != null && limit ? used / limit : null;
  const tone = ratio === null ? "gold" : ratio > 1 ? "error" : warnAt < 1 && ratio >= warnAt ? "warning" : "gold";
  const fill = { gold: "bg-gold", warning: "bg-warning", error: "bg-error" }[tone];
  const track = { gold: "bg-gold/12", warning: "bg-warning/15", error: "bg-error/15" }[tone];
  return <div className="min-w-0">
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-t3">{label}</span>
      <span className="truncate tabular-nums text-t1">
        {used == null ? "—" : format(used)}
        <span className="text-t4"> / {unlimited ? "∞" : limit != null ? format(limit) : missing}</span>
      </span>
    </div>
    <div className={cn("mt-1.5 h-1.5 overflow-hidden rounded-full", ratio === null ? "bg-bg-3" : track)}>
      {ratio !== null ? <div className={cn("h-full rounded-full", fill)} style={{ width: `${Math.max(2, Math.min(100, ratio * 100))}%` }} /> : null}
    </div>
  </div>;
}

