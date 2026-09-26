import { ActivityIndicator } from "react-native";
import { View } from "@/tw";
import {
  EditSectionHeader,
  ReadCard,
  ReadField,
} from "@/components/ui/EditSection";
import { formatDate, formatHours } from "@/lib/format";
import {
  usePersonPerformance,
  usePersonWorkedShifts,
} from "@/features/assignments/hooks";
import { personContract } from "@/features/staff/contract";
import type { StaffPersonDetail } from "@/features/staff/api";

/**
 * Il mese della persona in tre numeri, su **tutte** le sedi dell'azienda: sono
 * le ore della sua busta paga. Sta nei dati e non in una scheda sua: turni e ore
 * di sempre e una percentuale di «affidabilità» servivano a scegliere uno
 * sconosciuto sul marketplace, non a chi la persona ce l'ha già in organico.
 *
 * Il confronto col contratto solo se è mensile: convertire una settimana o un
 * giorno in un mese in corso darebbe un numero che nessuno ha firmato. Gemello
 * di `ThisMonth` nella scheda web.
 */
export function PersonThisMonthSection({
  person,
}: {
  person: StaffPersonDetail;
}) {
  const perfQuery = usePersonPerformance(person.id);
  const lastQuery = usePersonWorkedShifts(person.id, 1);

  const perf = perfQuery.data ?? null;
  const last = lastQuery.data?.[0] ?? null;
  const contract = personContract(person);
  const monthlyTarget = contract?.period === "month" ? contract.hours : null;

  return (
    <View className="gap-4">
      <EditSectionHeader title="Questo mese" />
      {perfQuery.isLoading || lastQuery.isLoading ? (
        <ActivityIndicator color="#EAB54C" className="self-start" />
      ) : (
        <ReadCard>
          <ReadField
            first
            label="Ore lavorate"
            value={
              formatHours(perf?.month_hours ?? 0) +
              (monthlyTarget != null
                ? ` su ${formatHours(monthlyTarget)} da contratto`
                : "")
            }
          />
          <ReadField
            label="Turni svolti"
            value={String(perf?.month_shifts ?? 0)}
          />
          <ReadField
            label="Ultimo turno"
            value={last ? formatDate(last.date) : null}
          />
        </ReadCard>
      )}
    </View>
  );
}
