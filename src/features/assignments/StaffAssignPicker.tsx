import { ActivityIndicator } from "react-native";
import { Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { Pill } from "@/components/ui/Pill";
import { cn } from "@/lib/cn";
import type { ShiftTimes } from "@/lib/format";
import { absenceForShift } from "@/features/absences/conflicts";
import { useAbsenceAvailability } from "@/features/absences/hooks";
import { absenceCellLabel } from "@/features/absences/labels";
import { staffRoleNames, type StaffMemberWithWaiter } from "@/features/staff/api";
import { useSelfStaff } from "@/features/staff/self";
import {
  ASSIGNMENT_STATUS_LABEL,
  isActiveAssignment,
  type AssignmentStatus,
} from "./status";

type Props = {
  staff: StaffMemberWithWaiter[];
  loading?: boolean;
  /** Solo i selezionati: id della persona → ruolo scelto per questo turno. */
  value: Record<string, string | null>;
  onToggle: (member: StaffMemberWithWaiter) => void;
  onRoleChange: (staffId: string, roleId: string | null) => void;
  /** Stato già a sistema (solo in modifica): chi ha rifiutato non copre. */
  statusFor?: (staffId: string) => AssignmentStatus;
  /**
   * Giorno e orario del turno: servono a segnalare chi è assente. È un avviso e
   * non un blocco — il titolare può sapere cose che l'app non sa.
   */
  shiftTimes?: ShiftTimes;
};

/**
 * "Chi chiami": selezione delle persone **e** del ruolo che ciascuna ricopre su
 * questo turno. Condivisa da creazione e modifica, che prima ne tenevano due
 * copie identiche — e la scelta del ruolo le avrebbe fatte divergere.
 *
 * Il ruolo si sceglie solo per chi ne ha più di uno: con una mansione sola non
 * c'è niente da decidere e mostrarla come opzione sarebbe rumore.
 */
export function StaffAssignPicker({
  staff,
  loading,
  value,
  onToggle,
  onRoleChange,
  statusFor,
  shiftTimes,
}: Props) {
  const absences =
    useAbsenceAvailability(
      shiftTimes?.date ?? "",
      shiftTimes?.date ?? "",
      !!shiftTimes
    ).data ?? [];
  // Chi gestisce la sede può essere in organico: la propria riga si riconosce,
  // altrimenti in un elenco di nomi si cerca il proprio senza trovarlo.
  const self = useSelfStaff();

  return (
    <View className="gap-3">
      <Mono>Chi chiami</Mono>
      {loading ? (
        <ActivityIndicator color="#EAB54C" className="mt-2" />
      ) : staff.length === 0 ? (
        <EmptyState
          title="Nessuno nello staff"
          subtitle="Aggiungi prima qualcuno dalla scheda «Staff»."
        />
      ) : (
        <View className="gap-3">
          {staff.map((m) => {
            const active = m.id in value;
            const status = statusFor?.(m.id) ?? "assigned";
            const works = isActiveAssignment(status);
            const roles = m.staff_member_roles
              .map((r) => r.role)
              .filter((r): r is NonNullable<typeof r> => !!r)
              .sort((a, b) => a.sort_order - b.sort_order);
            const chosen = value[m.id] ?? null;
            const absence = shiftTimes
              ? absenceForShift(
                  shiftTimes,
                  absences.filter((a) => a.person_id === m.person_id)
                )
              : null;

            return (
              <Card
                key={m.id}
                className={cn(
                  "rounded-3xl border-border-2 p-4",
                  active && (works ? "border-gold" : "border-error")
                )}
                onPress={() => onToggle(m)}
              >
                <View className="flex-row items-center gap-3">
                  <Avatar
                    uri={m.waiter?.avatar_url ?? undefined}
                    name={m.display_name}
                    size={40}
                  />
                  <View className="flex-1">
                    <View className="flex-row items-center gap-1.5">
                      <Text className="text-base font-sans-bold text-t1">
                        {m.display_name}
                      </Text>
                      {self.isSelf(m.waiter_id) ? (
                        <Pill label="Tu" variant="tag" />
                      ) : null}
                    </View>
                    <Text className="text-xs text-t3">
                      {staffRoleNames(m) ?? "Ruoli non indicati"}
                    </Text>
                    {absence ? (
                      <Text className="text-xs font-sans-semibold text-warning">
                        {absenceCellLabel(absence)}
                      </Text>
                    ) : null}
                    {active && !works ? (
                      <Text className="text-xs font-sans-semibold text-error">
                        {ASSIGNMENT_STATUS_LABEL[status]} · non copre il turno
                      </Text>
                    ) : null}
                  </View>
                  <View
                    className={cn(
                      "h-6 w-6 items-center justify-center rounded-full border",
                      !active && "border-border",
                      active && works && "border-gold bg-gold",
                      active && !works && "border-error"
                    )}
                  >
                    {active ? (
                      works ? (
                        <Icon name="check" size={14} color="#1A1206" />
                      ) : (
                        <Icon name="close" size={14} color="#e55b45" />
                      )
                    ) : null}
                  </View>
                </View>

                {active && roles.length > 1 ? (
                  <View className="mt-3 gap-2 border-t border-border-2 pt-3">
                    <Text className="text-xs text-t3">
                      In che ruolo lavora in questo turno
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      {roles.map((r) => (
                        <Chip
                          key={r.id}
                          label={r.name}
                          active={chosen === r.id}
                          gold={chosen === r.id}
                          onPress={() =>
                            onRoleChange(m.id, chosen === r.id ? null : r.id)
                          }
                        />
                      ))}
                    </View>
                  </View>
                ) : null}
              </Card>
            );
          })}
        </View>
      )}
    </View>
  );
}

/**
 * Il ruolo da preselezionare quando si aggiunge una persona a un turno: il suo,
 * se ne ha uno solo. Con più mansioni resta da scegliere — indovinare
 * direbbe "coperto" un fabbisogno che nessuno ha confermato di coprire.
 */
export function defaultRoleFor(member: StaffMemberWithWaiter): string | null {
  const roles = member.staff_member_roles
    .map((r) => r.role)
    .filter((r): r is NonNullable<typeof r> => !!r);
  return roles.length === 1 ? roles[0].id : null;
}
