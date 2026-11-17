import { Pressable, Text, View } from "@/tw";
import { cn } from "@/lib/cn";

export type SegmentedOption<T extends string> = { id: T; label: string };

/**
 * Due o tre viste della stessa schermata, una sola alla volta.
 *
 * Estratto da `(manager)/staff/new` quando la tab Turni del dipendente ha
 * avuto bisogno dello stesso controllo per «I miei» / «La sede»: due copie
 * dello stesso blocco sono il modo in cui due schermate iniziano a usare due
 * raggi d'angolo diversi.
 *
 * Non è una tab bar: le tab cambiano rotta, questo cambia solo cosa disegna la
 * schermata che si sta già guardando.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  compact = false,
  className,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Stretto, accanto a un'etichetta (Settimana/Mese in Home). */
  compact?: boolean;
  className?: string;
}) {
  return (
    <View
      className={cn(
        "flex-row gap-1 rounded-2xl border border-border bg-bg-card p-1",
        compact && "self-start rounded-xl p-0.5",
        className
      )}
    >
      {options.map((o) => {
        const active = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className={cn(
              // Dorata sull'opzione scelta, come sulla dashboard (15/11):
              // prima qui era grigia e la Home usava due chip dorate.
              compact ? "items-center rounded-[10px] px-2.5 py-1" : "flex-1 items-center rounded-xl py-2.5",
              active && "bg-gold-fill"
            )}
          >
            <Text
              className={cn(
                compact ? "text-xs" : "text-sm",
                active ? "font-sans-semibold text-gold-ink" : "text-t3"
              )}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
