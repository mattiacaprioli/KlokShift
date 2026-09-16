import { ActivityIndicator } from "react-native";
import { Pressable, Text, View } from "@/tw";
import { formatDate, formatShiftRange } from "@/lib/format";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import type { AbsenceWindow } from "./conflicts";
import { useAbsenceConflicts, useRemoveFromShifts } from "./hooks";

export type ConflictShift = ReturnType<
  typeof useAbsenceConflicts
>["conflicts"][number];

/** L'elenco dei turni in conflitto: giorno, orario, titolo e sede. */
export function ConflictShiftList({ shifts }: { shifts: ConflictShift[] }) {
  const { venues, isMultiVenue } = useOwnerVenues();
  return (
    <View className="gap-1.5">
      {shifts.map((s) => {
        const venue = isMultiVenue
          ? venues.find((v) => v.id === s.venue_id)?.name
          : null;
        return (
          <Text key={s.assignmentId} className="text-[13px] text-t2">
            {formatDate(s.date)} · {formatShiftRange(s.start_time, s.end_time)} ·{" "}
            {[s.title, venue].filter(Boolean).join(" · ")}
          </Text>
        );
      })}
    </View>
  );
}

/**
 * I turni che un'assenza **già approvata** lascia scoperti, con «Togli dai
 * turni». Per la malattia è il blocco che serve davvero: la persona non verrà,
 * e il posto va liberato per trovare chi copre.
 *
 * Non compare niente se non ci sono conflitti, o se chi guarda non gestisce i
 * turni di quelle sedi (la RLS non gli restituisce le assegnazioni).
 */
export function AbsenceConflictsBlock({
  absence,
}: {
  absence: AbsenceWindow & { person_id: string };
}) {
  const toast = useToast();
  const { conflicts, isLoading } = useAbsenceConflicts(
    absence,
    absence.status === "approved"
  );
  const remove = useRemoveFromShifts();

  if (absence.status !== "approved") return null;
  if (isLoading) return <ActivityIndicator color="#EAB54C" className="mt-3" />;
  if (conflicts.length === 0) return null;

  function onRemove() {
    remove.mutate(
      conflicts.map((c) => c.assignmentId),
      {
        onSuccess: () =>
          toast.show(
            conflicts.length === 1
              ? "Tolto dal turno: ora è scoperto"
              : `Tolto da ${conflicts.length} turni: ora sono scoperti`
          ),
        onError: (e) =>
          toast.show(userErrorMessage(e, "Operazione non riuscita."), "error"),
      }
    );
  }

  return (
    <View className="mt-3 gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
      <Text className="text-[13px] font-sans-semibold text-warning">
        {conflicts.length === 1
          ? "È ancora in turno in quei giorni"
          : `È ancora in ${conflicts.length} turni in quei giorni`}
      </Text>
      <ConflictShiftList shifts={conflicts} />
      <Pressable
        onPress={onRemove}
        disabled={remove.isPending}
        className="mt-1 items-center rounded-xl border border-border py-2.5"
      >
        <Text className="text-sm font-sans-semibold text-t1">
          {remove.isPending ? "Attendere…" : "Togli dai turni"}
        </Text>
      </Pressable>
      <Text className="text-xs leading-4 text-t3">
        Il turno resta, scoperto: chi viene tolto riceve «Turno revocato».
      </Text>
    </View>
  );
}
