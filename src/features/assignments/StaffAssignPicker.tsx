import { useState } from "react";
import { ActivityIndicator } from "react-native";
import { Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/ui/Mono";
import { Pill } from "@/components/ui/Pill";
import { cn } from "@/lib/cn";
import { staffRoleNames } from "@/features/staff/api";
import {
  STAFF_SEARCH_FROM,
  matchesStaffSearch,
} from "@/features/staff/search";
import type { StaffMemberWithWaiter } from "@/features/staff/types";
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
   * Gli avvisi sotto il nome (assente, già in turno a quell'ora), per persona:
   * li calcola il form con `usePlanChecks`, che conosce i giorni del turno.
   * Avvisi e non blocchi — il titolare può sapere cose che l'app non sa.
   */
  notesFor?: (member: StaffMemberWithWaiter) => string[];
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
  notesFor,
}: Props) {
  // Chi gestisce la sede può essere nel team: la propria riga si riconosce,
  // altrimenti in un elenco di nomi si cerca il proprio senza trovarlo.
  const self = useSelfStaff();
  const [search, setSearch] = useState("");
  // Chi è già scelto resta in vista anche se non corrisponde: la ricerca serve
  // a trovare, non a far sparire una scelta già fatta.
  const shown = staff.filter(
    (m) => m.id in value || matchesStaffSearch(m, search)
  );

  return (
    <View className="gap-3">
      <Mono>Chi chiami</Mono>
      {loading ? (
        <ActivityIndicator color="#EAB54C" className="mt-2" />
      ) : staff.length === 0 ? (
        <EmptyState
          title="Nessuno nel team"
          subtitle="Aggiungi prima qualcuno dalla scheda «Team»."
        />
      ) : (
        <View className="gap-3">
          {staff.length >= STAFF_SEARCH_FROM ? (
            <Input
              value={search}
              onChangeText={setSearch}
              placeholder="Cerca per nome o ruolo…"
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
            />
          ) : null}
          {shown.length === 0 ? (
            <Text className="text-[13px] text-t3">
              Nessuno corrisponde a «{search.trim()}».
            </Text>
          ) : null}
          {shown.map((m) => {
            const active = m.id in value;
            const status = statusFor?.(m.id) ?? "assigned";
            const works = isActiveAssignment(status);
            const roles = m.staff_member_roles
              .map((r) => r.role)
              .filter((r): r is NonNullable<typeof r> => !!r)
              .sort((a, b) => a.sort_order - b.sort_order);
            const chosen = value[m.id] ?? null;
            const notes = notesFor?.(m) ?? [];

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
                    {notes.map((note) => (
                      <Text
                        key={note}
                        className="text-xs font-sans-semibold text-warning"
                      >
                        {note}
                      </Text>
                    ))}
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

// Puro, in un modulo suo: lo usa anche la dashboard web.
export { defaultRoleFor } from "./defaultRole";
