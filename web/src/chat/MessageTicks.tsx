import { cn } from "@/lib/cn";
import {
  MESSAGE_STATUS_LABEL,
  type MessageStatus,
} from "@/features/chat/messageStatus";

/**
 * Le spunte di un mio messaggio sulla dashboard, gemelle di
 * `src/features/chat/MessageTicks.tsx`: niente blu, è l'intensità a dire
 * «visualizzato» (pieno) contro il resto (attenuato).
 *
 * `tone="bubble"` sta sulla bolla oro; `tone="list"` sulla card della lista.
 */
export function MessageTicks({
  status,
  tone = "bubble",
}: {
  status: MessageStatus;
  tone?: "bubble" | "list";
}) {
  const read = status === "read";
  const color =
    tone === "bubble" ? "text-gold-ink" : read ? "text-gold" : "text-t4";
  return (
    <svg
      role="img"
      aria-label={MESSAGE_STATUS_LABEL[status]}
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", color, !read && "opacity-50")}
    >
      <title>{MESSAGE_STATUS_LABEL[status]}</title>
      {status === "sending" ? (
        <>
          <circle cx={12} cy={12} r={9} strokeWidth={1.6} />
          <path d="M12 7.5V12l3 1.8" strokeWidth={1.6} />
        </>
      ) : status === "sent" ? (
        <path d="M5 12l5 5 9-10" />
      ) : (
        <path d="M2 12.5l4.5 4.5 8.5-10M10.5 16l1 1 8.5-10" />
      )}
    </svg>
  );
}
