import { useState } from "react";
import { ActivityIndicator, Modal, Switch } from "react-native";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { useCopyInternalShifts } from "@/features/assignments/hooks";
import { addDaysToDate, formatDate, formatShiftRange } from "@/lib/format";
import { userErrorMessage } from "@/lib/errors";
import { useNow } from "@/lib/useNow";
import { useToast } from "@/providers/Toast";
import {
  DUPLICATE_BULK_WARN,
  DUPLICATE_NOTHING_PAST,
  DUPLICATE_WITH_STAFF_LABEL,
  classifyDuplicate,
  duplicateCreatedToast,
  duplicateNotificationsWarning,
  duplicateSkippedPastText,
  duplicateTargetExistingText,
  duplicateWithStaffHint,
  weekDateMap,
  weekRangeLabel,
} from "./duplicate";
import { useOwnerShiftsRange } from "./hooks";

/** Righe di anteprima: la settimana intera può essere lunga. */
const PREVIEW_ROWS = 12;

/**
 * «Duplica la settimana» dall'agenda dell'app: la settimana che si sta
 * guardando, copiata su quella dopo (o più avanti). Gemello del dialogo della
 * dashboard, con le stesse regole e frasi (`duplicate.ts`); qui solo la
 * settimana — il mese resta sulla dashboard, dove si pianifica in grande.
 *
 * ⚠️ Ogni copia resta nella sede del turno che l'ha generata: ci pensa
 * `getInternalShiftPlans`, che porta il `venue_id` per piano.
 */
export function DuplicateWeekModal({
  monday,
  venueIds,
  onClose,
}: {
  /** Il lunedì ("YYYY-MM-DD") della settimana da copiare. */
  monday: string;
  /** Le sedi accese nell'agenda su cui si possono fare turni. */
  venueIds: string[];
  onClose: () => void;
}) {
  const toast = useToast();
  const copy = useCopyInternalShifts();
  const [weeks, setWeeks] = useState(1);
  const [withStaff, setWithStaff] = useState(true);

  const sourceQuery = useOwnerShiftsRange(monday, addDaysToDate(monday, 6), venueIds);
  const target = addDaysToDate(monday, weeks * 7);
  const targetQuery = useOwnerShiftsRange(target, addDaysToDate(target, 6), venueIds);

  const now = useNow();
  const shifts = sourceQuery.data ?? [];
  const dateMap = weekDateMap(shifts, weeks);
  const {
    copyable,
    skippedCancelled,
    skippedUnplanned,
    skippedPast,
    notifications,
  } = classifyDuplicate(shifts, dateMap, now);
  // La copia aggiunge, non sostituisce: va detto prima.
  const targetExisting = (targetQuery.data ?? []).filter(
    (s) => s.status !== "cancelled"
  ).length;
  const targetLabel = weekRangeLabel(target);
  const preview = copyable.slice(0, PREVIEW_ROWS);

  function submit() {
    copy.mutate(
      { sourceIds: copyable.map((s) => s.id), dateMap, withStaff },
      {
        onSuccess: (created) => {
          toast.show(duplicateCreatedToast(created.length, targetLabel));
          onClose();
        },
        onError: (error) =>
          toast.show(userErrorMessage(error, "Impossibile copiare la settimana."), "error"),
      }
    );
  }

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable
        onPress={copy.isPending ? undefined : onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.66)" }}
        className="items-center justify-center px-5"
      >
        <Pressable
          onPress={() => {}}
          className="max-h-[88%] w-full rounded-3xl border border-border-2 bg-bg-card p-6"
        >
          <Text className="text-lg font-sans-bold text-t1">Duplica la settimana</Text>
          <Text className="mt-1 text-xs text-t3">
            Da {weekRangeLabel(monday)} — {copyable.length}{" "}
            {copyable.length === 1 ? "turno" : "turni"}
          </Text>

          {sourceQuery.isLoading ? (
            <ActivityIndicator color="#EAB54C" className="mt-6" />
          ) : copyable.length === 0 ? (
            <Text className="mt-5 text-sm leading-5 text-t3">
              {skippedPast > 0
                ? DUPLICATE_NOTHING_PAST
                : "Questa settimana non ha turni da copiare."}
            </Text>
          ) : (
            <ScrollView className="mt-5" showsVerticalScrollIndicator={false}>
              <Mono>Copia su</Mono>
              <View className="mt-2 flex-row items-center gap-2">
                <Pressable
                  disabled={weeks <= 1}
                  onPress={() => setWeeks((w) => Math.max(1, w - 1))}
                  accessibilityRole="button"
                  accessibilityLabel="Settimana precedente"
                  className="h-10 w-10 items-center justify-center rounded-full border border-border-2"
                  style={weeks <= 1 ? { opacity: 0.35 } : undefined}
                >
                  <Icon name="chevL" size={16} color="#EAB54C" />
                </Pressable>
                <Text className="flex-1 text-center text-sm font-sans-semibold text-t1">
                  {targetLabel}
                </Text>
                <Pressable
                  onPress={() => setWeeks((w) => w + 1)}
                  accessibilityRole="button"
                  accessibilityLabel="Settimana successiva"
                  className="h-10 w-10 items-center justify-center rounded-full border border-border-2"
                >
                  <Icon name="chevR" size={16} color="#EAB54C" />
                </Pressable>
              </View>
              <Text className="mt-1.5 text-xs text-t3">
                {weeks === 1 ? "La settimana subito dopo." : `${weeks} settimane dopo.`}
              </Text>

              <View className="mt-5 flex-row items-center justify-between gap-3">
                <View className="flex-1">
                  <Text className="text-[15px] font-sans-semibold text-t1">
                    {DUPLICATE_WITH_STAFF_LABEL}
                  </Text>
                  <Text className="mt-0.5 text-[13px] text-t3">
                    {duplicateWithStaffHint(withStaff)}
                  </Text>
                </View>
                <Switch
                  value={withStaff}
                  onValueChange={setWithStaff}
                  disabled={copy.isPending}
                  trackColor={{ false: "#2a241b", true: "#eab54c" }}
                  thumbColor="#f8f4ed"
                  ios_backgroundColor="#2a241b"
                />
              </View>

              {withStaff && notifications >= DUPLICATE_BULK_WARN ? (
                <Text className="mt-4 text-xs leading-4 text-warning">
                  {duplicateNotificationsWarning(notifications)}
                </Text>
              ) : null}
              {skippedPast > 0 ? (
                <Text className="mt-4 text-xs leading-4 text-t3">
                  {duplicateSkippedPastText(skippedPast)}
                </Text>
              ) : null}
              {targetExisting > 0 ? (
                <Text className="mt-4 text-xs leading-4 text-warning">
                  {duplicateTargetExistingText(targetExisting, false)}
                </Text>
              ) : null}

              <Mono className="mt-5">Cosa verrà creato</Mono>
              <View className="mt-2 gap-1.5">
                {preview.map((s) => (
                  <View
                    key={s.id}
                    className="flex-row items-center gap-2 rounded-xl border border-border-2 bg-bg-1 px-3 py-2"
                  >
                    <Text className="flex-1 text-sm text-t1" numberOfLines={1}>
                      {s.title}
                    </Text>
                    <Text className="font-mono text-xs text-t3">
                      {formatShiftRange(s.start_time, s.end_time)}
                    </Text>
                    <Text className="w-24 text-right text-xs text-t2">
                      {formatDate(dateMap[s.date])}
                    </Text>
                  </View>
                ))}
              </View>
              {copyable.length > preview.length ? (
                <Text className="mt-2 text-xs text-t3">
                  e altri {copyable.length - preview.length} turni.
                </Text>
              ) : null}
              {skippedCancelled > 0 || skippedUnplanned > 0 ? (
                <Text className="mt-2 text-xs text-t3">
                  Esclusi:{" "}
                  {[
                    skippedCancelled > 0 ? `${skippedCancelled} annullati` : null,
                    skippedUnplanned > 0 ? `${skippedUnplanned} fuori turno` : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </Text>
              ) : null}
            </ScrollView>
          )}

          <View className="mt-6 gap-2.5">
            {copyable.length > 0 ? (
              <GoldButton
                label={
                  copy.isPending
                    ? "Copia in corso…"
                    : `Crea ${copyable.length} ${copyable.length === 1 ? "turno" : "turni"}`
                }
                disabled={copy.isPending}
                onPress={submit}
              />
            ) : null}
            <Pressable disabled={copy.isPending} onPress={onClose} className="items-center py-2">
              <Text className="text-sm text-t3">
                {copyable.length > 0 ? "Annulla" : "Chiudi"}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
