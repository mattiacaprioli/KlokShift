import { ActivityIndicator, Modal } from "react-native";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { staffRoleNames } from "@/features/staff/api";
import { useVenueStaff } from "@/features/staff/hooks";
import { useSelfStaff } from "@/features/staff/self";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import type { AssignmentWithStaff } from "./api";
import { ADD_WORKER_HINT, ADD_WORKER_LABEL, shiftWorkerCandidates } from "./addWorker";
import { useAddShiftWorker } from "./hooks";
import { defaultRoleFor } from "./defaultRole";

/**
 * «Aggiungi chi ha lavorato» su un turno finito: si tocca la persona e risulta
 * presente, con le ore del turno (`add_shift_worker`). Gemello della scelta
 * nelle presenze della dashboard; chi offrire lo decide `shiftWorkerCandidates`.
 */
export function AddShiftWorkerModal({
  shiftId,
  venueId,
  assignments,
  onClose,
}: {
  shiftId: string;
  venueId: string;
  /** Chi è già sul turno, rifiutati compresi. */
  assignments: AssignmentWithStaff[];
  onClose: () => void;
}) {
  const toast = useToast();
  const { isOwner } = useOwnerVenues();
  const self = useSelfStaff();
  const staffQuery = useVenueStaff(venueId);
  const add = useAddShiftWorker(shiftId);
  const candidates = shiftWorkerCandidates(
    staffQuery.data ?? [],
    assignments,
    // Le proprie ore le segna solo il titolare.
    (waiterId) => !isOwner && self.isSelf(waiterId)
  );

  function onPick(member: (typeof candidates)[number]) {
    add.mutate(
      { venueMemberId: member.id, roleId: defaultRoleFor(member) },
      {
        onSuccess: () => {
          toast.show(`${member.display_name} aggiunto: le ore contano già.`);
          onClose();
        },
        onError: (error) =>
          toast.show(userErrorMessage(error, "Impossibile aggiungerlo. Riprova."), "error"),
      }
    );
  }

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable
        onPress={add.isPending ? undefined : onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.66)" }}
        className="items-center justify-center px-6"
      >
        <Pressable
          onPress={() => {}}
          className="max-h-[80%] w-full rounded-3xl border border-border-2 bg-bg-card p-6"
        >
          <Text className="text-lg font-sans-bold text-t1">{ADD_WORKER_LABEL}</Text>
          <Text className="mt-2 text-sm leading-5 text-t2">{ADD_WORKER_HINT}</Text>

          <ScrollView className="mt-5" showsVerticalScrollIndicator={false}>
            {staffQuery.isLoading ? (
              <ActivityIndicator color="#EAB54C" />
            ) : candidates.length === 0 ? (
              <Text className="text-sm text-t3">
                In questa sede non c&apos;è nessun altro in organico da aggiungere.
              </Text>
            ) : (
              <View className="gap-2">
                {candidates.map((m) => (
                  <Pressable
                    key={m.id}
                    disabled={add.isPending}
                    onPress={() => onPick(m)}
                    accessibilityRole="button"
                    className="flex-row items-center gap-3 rounded-2xl border border-border-2 bg-bg-1 px-3 py-2.5"
                  >
                    <Avatar uri={m.waiter?.avatar_url ?? undefined} name={m.display_name} size={36} />
                    <View className="flex-1">
                      <Text className="text-sm font-sans-semibold text-t1">{m.display_name}</Text>
                      <Text className="text-xs text-t3">
                        {staffRoleNames(m) ?? "Ruoli non indicati"}
                      </Text>
                    </View>
                    <Text className="text-sm font-sans-semibold text-gold">Aggiungi</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>

          <Pressable
            disabled={add.isPending}
            onPress={onClose}
            className="mt-5 items-center py-2"
          >
            <Text className="text-sm text-t3">{add.isPending ? "Attendere…" : "Indietro"}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
