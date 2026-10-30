import { cn } from "@/lib/cn";
import { Text, View } from "@/tw";

/**
 * «Chiusa · Ferragosto», uguale sotto il calendario e sull'intestazione del
 * giorno. Grigio pieno e maiuscoletto: si vede a colpo d'occhio senza usare
 * l'arancio, che nell'agenda vuol dire «c'è un problema».
 */
export function ClosedDayBadge({ text, className }: { text: string; className?: string }) {
  return (
    <View
      className={cn(
        "mt-1.5 self-start rounded-full border border-border-2 bg-bg-3 px-3 py-1",
        className
      )}
    >
      <Text
        className="font-mono text-[10.5px] uppercase text-t1"
        style={{ letterSpacing: 1.2 }}
        numberOfLines={1}
      >
        {text}
      </Text>
    </View>
  );
}
