import { Pressable, Text, View } from "@/tw";
import { cn } from "@/lib/cn";

/**
 * Compact metric cell (value + label). Used in the home stat strip and profile stats.
 * Same shell as the list cards around it (Richieste, Chi lavora oggi): a stat
 * strip in a different material read as a separate widget stuck on the page.
 */
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
  /** In minuscolo dopo l'iniziale, come un titolo di card: «Turni scoperti». */
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
        "flex-1 rounded-3xl border border-border-2 bg-bg-card px-4 py-3.5",
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
      <Text className="mt-1 text-sm font-sans-semibold text-t2">{label}</Text>
      {hint && !loading ? (
        <Text className="mt-0.5 text-xs text-t3">{hint}</Text>
      ) : null}
    </Root>
  );
}
