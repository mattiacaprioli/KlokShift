import { Pressable, Text, View } from "@/tw";
import { cn } from "@/lib/cn";
import { Mono } from "./Mono";

/** Compact metric cell (value + mono label). Used in the home stat strip and profile stats. */
export function StatCard({
  value,
  label,
  hint,
  tone = "normal",
  loading = false,
  onPress,
  className,
}: {
  value: string;
  label: string;
  /** La riga sotto l'etichetta: cosa il numero conta, quando non è ovvio. */
  hint?: string;
  /** `warning` per i numeri che chiedono un intervento (posti scoperti). */
  tone?: "normal" | "warning";
  /** Dato non ancora disponibile: un trattino, non uno zero. */
  loading?: boolean;
  /** Rende la cella toccabile: per i numeri su cui c'è qualcosa da fare. */
  onPress?: () => void;
  className?: string;
}) {
  const Root = onPress ? Pressable : View;
  return (
    <Root
      onPress={onPress}
      className={cn(
        "flex-1 rounded-2xl border border-border bg-bg-2 px-3.5 pb-3 pt-3.5",
        className
      )}
    >
      <Text
        className={cn(
          "text-2xl font-sans-bold",
          loading ? "text-t4" : tone === "warning" ? "text-warning" : "text-t1"
        )}
        style={{ letterSpacing: -0.5 }}
      >
        {loading ? "—" : value}
      </Text>
      <Mono className="mt-1.5">{label}</Mono>
      {hint && !loading ? (
        <Text className="mt-1 text-[11px] text-t4">{hint}</Text>
      ) : null}
    </Root>
  );
}
