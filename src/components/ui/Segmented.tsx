import { Pressable, Text, View } from "@/tw";
import { cn } from "@/lib/cn";

export type SegmentedOption<T extends string> = { id: T; label: string };

/**
 * Due o tre viste della stessa schermata, una sola alla volta.
 *
 * Estratto da `(manager)/staff/new` quando la tab Turni del professionista ha
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
  className,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <View
      className={cn(
        "flex-row gap-1 rounded-2xl border border-border bg-bg-card p-1",
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
              "flex-1 items-center rounded-xl py-2.5",
              active && "bg-bg-2"
            )}
          >
            <Text
              className={cn(
                "text-sm",
                active ? "font-sans-semibold text-t1" : "text-t3"
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
