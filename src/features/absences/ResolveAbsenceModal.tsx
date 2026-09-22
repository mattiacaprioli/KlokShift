import { useState } from "react";
import { Modal } from "react-native";
import { Pressable, Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { ConflictShiftList } from "./AbsenceConflicts";
import {
  useAbsenceConflicts,
  useRemoveFromShifts,
  useResolveAbsence,
} from "./hooks";
import type { Absence } from "./api";
import { ABSENCE_KIND_LABEL, formatAbsenceRange } from "./labels";

/**
 * La decisione su una richiesta di ferie o permesso.
 *
 * Approvare **non** toglie la persona dai turni che cadono nell'assenza: come
 * per le richieste di orario, un tap su «Approva» non cancella assegnazioni come
 * effetto collaterale. I turni in conflitto si **mostrano**, e toglierli è un
 * bottone a parte: «Approva e togli dai turni».
 */
export function ResolveAbsenceModal({
  absence,
  personName,
  onClose,
}: {
  absence: Absence;
  /** Il nome della persona, quando chi apre il modal non è nel thread. */
  personName?: string | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const resolve = useResolveAbsence();
  const remove = useRemoveFromShifts();
  const { conflicts, isLoading: loadingConflicts } = useAbsenceConflicts(absence);
  const [note, setNote] = useState("");
  const busy = resolve.isPending || remove.isPending;

  function decide(approve: boolean, clearShifts = false) {
    resolve.mutate(
      { absenceId: absence.id, approve, note },
      {
        onSuccess: async () => {
          // Prima si approva, poi si tolgono i turni: se la seconda fallisce,
          // la decisione è comunque presa e i turni si tolgono dalla card.
          if (clearShifts && conflicts.length > 0) {
            try {
              await remove.mutateAsync(conflicts.map((c) => c.assignmentId));
            } catch (e) {
              onClose();
              toast.show(
                `Richiesta approvata. ${userErrorMessage(e, "Non siamo riusciti a verificare la rimozione dai turni. Controlla l’elenco aggiornato.")}`,
                "error"
              );
              return;
            }
          }
          onClose();
          toast.show(
            !approve
              ? "Richiesta rifiutata"
              : clearShifts
                ? "Approvata: turni liberati"
                : "Richiesta approvata"
          );
        },
        onError: (e) =>
          toast.show(
            userErrorMessage(e, "Operazione non riuscita. Riprova."),
            "error"
          ),
      }
    );
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        onPress={busy ? undefined : onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }}
        className="items-center justify-center px-6"
      >
        <Pressable
          onPress={() => {}}
          className="w-full rounded-3xl border border-border-2 bg-bg-card p-6"
        >
          <Text className="text-lg font-sans-bold text-t1">
            {ABSENCE_KIND_LABEL[absence.kind]}
            {personName ? ` · ${personName}` : ""}
          </Text>
          <Text className="mt-1 text-sm text-t2">
            {formatAbsenceRange(absence)}
          </Text>
          {absence.note ? (
            <Text className="mt-3 text-[15px] leading-5 text-t1">
              {absence.note}
            </Text>
          ) : null}
          {loadingConflicts ? null : conflicts.length > 0 ? (
            <View className="mt-3 gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
              <Text className="text-[13px] font-sans-semibold text-warning">
                {conflicts.length === 1
                  ? "In quei giorni è in turno"
                  : `In quei giorni è in ${conflicts.length} turni`}
              </Text>
              <ConflictShiftList shifts={conflicts} />
            </View>
          ) : (
            <Text className="mt-3 text-xs leading-4 text-t3">
              Nessun turno in quei giorni.
            </Text>
          )}

          <View className="mt-4">
            <Input
              label="Nota (facoltativa)"
              value={note}
              onChangeText={setNote}
              placeholder="Visibile a chi ha chiesto"
              maxLength={300}
            />
          </View>

          <View className="mt-6 gap-2.5">
            {conflicts.length > 0 ? (
              <GoldButton
                label={busy ? "Attendere…" : "Approva e togli dai turni"}
                disabled={busy}
                onPress={() => decide(true, true)}
              />
            ) : null}
            {conflicts.length > 0 ? (
              <Pressable
                onPress={() => decide(true)}
                disabled={busy}
                className="items-center rounded-xl border border-border py-3.5"
              >
                <Text className="text-sm font-sans-semibold text-t1">
                  Approva, i turni li sistemo io
                </Text>
              </Pressable>
            ) : (
              <GoldButton
                label={busy ? "Attendere…" : "Approva"}
                disabled={busy}
                onPress={() => decide(true)}
              />
            )}
            <Pressable
              onPress={() => decide(false)}
              disabled={busy}
              className="items-center rounded-xl border border-border py-3.5"
            >
              <Text className="text-sm font-sans-semibold text-t2">
                Rifiuta la richiesta
              </Text>
            </Pressable>
            <Pressable
              onPress={onClose}
              disabled={busy}
              className="items-center py-2"
            >
              <Text className="text-sm text-t4">Decidi dopo</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
