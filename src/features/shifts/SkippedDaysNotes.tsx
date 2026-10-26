import { Pressable, Text, View } from "@/tw";
import type { StaffMemberWithWaiter } from "@/features/staff/types";
import { skippedNote } from "./repeat";

/**
 * Chi resta fuori da qualche giorno del turno ripetuto per un'assenza
 * approvata, e il comando per metterlo comunque. Avviso, non blocco. Gemello
 * di `SkippedNotes` nel pannello web, con le stesse frasi (`skippedNote`).
 */
export function SkippedDaysNotes({
  staff,
  skippedDays,
  forced,
  onToggle,
}: {
  /** Le persone scelte che hanno almeno un giorno saltato. */
  staff: StaffMemberWithWaiter[];
  skippedDays: Map<string, string[]>;
  forced: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (!staff.length) return null;
  return (
    // Sfondo inline come nelle `Pill`: `bg-warning/5` passerebbe da
    // `color-mix`, che react-native-css non regge.
    <View
      className="gap-2 rounded-2xl border border-warning px-3.5 py-3"
      style={{ backgroundColor: "rgba(226,146,47,0.08)" }}
    >
      {staff.map((m) => {
        const note = skippedNote(
          m.display_name,
          skippedDays.get(m.id) ?? [],
          forced.has(m.id)
        );
        return (
          <View key={m.id} className="gap-1">
            <Text className="text-xs leading-5 text-t2">{note.text}</Text>
            <Pressable
              onPress={() => onToggle(m.id)}
              hitSlop={8}
              accessibilityRole="button"
              className="self-start"
            >
              <Text className="text-xs font-sans-semibold text-gold">
                {note.action}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
