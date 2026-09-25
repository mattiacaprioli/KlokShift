import { liveClockLabel, type LiveClockStatus } from "@/features/clock/live";
import { cn } from "@/lib/cn";

const TONE = {
  muted: "text-t4",
  warning: "text-warning",
  success: "text-success",
  neutral: "text-t3",
} as const;

/**
 * La timbratura del giorno sotto il nome («In servizio dalle 13:58»), con il
 * suo pallino. Stessa frase dell'app: la dà `liveClockLabel`. Uno `span`,
 * perché nel pannello del turno sta dentro un bottone.
 */
export function LiveClockLine({
  status,
  className,
}: {
  status: LiveClockStatus;
  className?: string;
}) {
  const { label, tone } = liveClockLabel(status);
  return (
    <span
      className={cn(
        "mt-1 flex items-center gap-1.5 text-xs font-semibold",
        TONE[tone],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}
