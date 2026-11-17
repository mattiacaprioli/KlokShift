import { Text, View } from "@/tw";
import { cn } from "@/lib/cn";

type Props = {
  count: number;
  /** Posizionamento (es. "absolute -right-1 -top-1") o override stile. */
  className?: string;
};

/** Pill dorata col conteggio (cap "9+"). Non renderizza nulla se count <= 0. */
export function CountBadge({ count, className }: Props) {
  if (count <= 0) return null;
  return (
    <View
      className={cn(
        "h-4.5 min-w-4.5 items-center justify-center rounded-full bg-gold-fill px-1",
        className
      )}
    >
      <Text className="font-sans-bold text-[10px] text-gold-ink">
        {count > 9 ? "9+" : String(count)}
      </Text>
    </View>
  );
}
