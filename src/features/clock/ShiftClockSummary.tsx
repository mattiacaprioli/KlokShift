import { Text, View } from "@/tw";
import { Pill } from "@/components/ui/Pill";
import { formatHoursVariance } from "@/lib/format";
import type { ShiftWithAssignees } from "@/features/shifts/types";
import { clockAttentionForShift } from "./attention";
import { shiftDeviations } from "./hours";

/** Oltre questo numero di nomi la riga dice «e altri N». */
const MAX_DEVIATION_NAMES = 2;

/**
 * Il consuntivo di un turno concluso, sotto la sua card nello storico: se c'è
 * ancora una timbratura da chiudere o da approvare, e chi si è discostato
 * dall'orario. Stesse regole della colonna Ore della dashboard
 * (`web/src/pages/Storico.tsx`): per persona, mai una somma, e le ore solo
 * timbrate in colore d'avviso finché nessuno le approva.
 */
export function ShiftClockSummary({ shift }: { shift: ShiftWithAssignees }) {
  if (shift.status === "cancelled") return null;
  const kinds = clockAttentionForShift(shift).map((item) => item.kind);
  const { measured, deviations } = shiftDeviations(shift);
  const attention = kinds.includes("missing_out")
    ? "Uscita mancante"
    : kinds.includes("to_review")
      ? "Da approvare"
      : null;
  if (!attention && measured === 0) return null;

  const shown = deviations.slice(0, MAX_DEVIATION_NAMES);
  const others = deviations.length - shown.length;

  return (
    <View className="mt-2 flex-row flex-wrap items-center gap-2">
      {attention ? <Pill label={attention} variant="pending" icon="clock" /> : null}
      {measured > 0 ? (
        deviations.length === 0 ? (
          <Text className="text-[13px] text-t3">In orario</Text>
        ) : (
          <Text className="flex-1 text-[13px] text-t2" numberOfLines={1}>
            {shown.map((d, i) => (
              <Text key={`${d.name}:${i}`}>
                {i > 0 ? ", " : ""}
                {d.name}{" "}
                <Text
                  className={
                    d.proposed
                      ? "font-sans-semibold text-warning"
                      : "font-sans-semibold text-t1"
                  }
                >
                  {formatHoursVariance(d.delta)}
                </Text>
              </Text>
            ))}
            {others > 0 ? ` e altri ${others}` : ""}
          </Text>
        )
      ) : null}
    </View>
  );
}
