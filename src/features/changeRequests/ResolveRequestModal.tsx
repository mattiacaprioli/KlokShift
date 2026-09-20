import { useMemo, useState } from "react";
import { ActivityIndicator, Modal, ScrollView } from "react-native";
import { Pressable, Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { GoldButton } from "@/components/ui/GoldButton";
import { cn } from "@/lib/cn";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { useShift } from "@/features/shifts/hooks";
import { useVenueStaff } from "@/features/staff/hooks";
import { useShiftAssignments } from "@/features/assignments/hooks";
import { isActiveAssignment } from "@/features/assignments/status";
import { staffRoleNames } from "@/features/staff/api";
import { useResolveShiftChangeRequest } from "./hooks";
import type { ChangeRequest } from "./api";

/**
 * La decisione del titolare su una richiesta di sostituzione.
 *
 * Approvare **con** un sostituto passa da `reassign`: chi esce
 * riceve «Turno revocato», chi entra «Nuovo turno assegnato», e la sua riga
 * nasce pulita. Approvare **senza** sostituto lascia il posto scoperto, ed è una
 * risposta legittima — «va bene, non venire» — non un caso degenere: per questo
 * è un'opzione esplicita e non il risultato di aver dimenticato di scegliere.
 */
export function ResolveRequestModal({
  visible,
  request,
  onClose,
}: {
  visible: boolean;
  request: ChangeRequest;
  onClose: () => void;
}) {
  const toast = useToast();
  // Su una richiesta di orario non c'è nessun sostituto da scegliere: le tre
  // query dell'organico non servono e non vanno fatte.
  const isHours = request.kind === "hours";
  const shiftQuery = useShift(request.shift_id, !isHours);
  const venueId = shiftQuery.data?.venue_id;
  const staffQuery = useVenueStaff(isHours ? undefined : venueId);
  const assignmentsQuery = useShiftAssignments(
    request.shift_id,
    visible && !isHours
  );
  const resolve = useResolveShiftChangeRequest();

  const [replacement, setReplacement] = useState<string | null>(null);

  /** Chi è già sul turno non può sostituire sé stesso né chi c'è già. */
  const candidates = useMemo(() => {
    const busy = new Set(
      (assignmentsQuery.data ?? [])
        .filter((a) => isActiveAssignment(a.status))
        .map((a) => a.venue_member_id)
    );
    return (staffQuery.data ?? []).filter(
      (m) => m.link_status === "active" && !busy.has(m.id)
    );
  }, [assignmentsQuery.data, staffQuery.data]);

  function decide(approve: boolean) {
    resolve.mutate(
      {
        requestId: request.id,
        approve,
        replacementStaffMemberId: approve ? replacement : null,
      },
      {
        onSuccess: () => {
          onClose();
          toast.show(approve ? "Cambio approvato" : "Richiesta rifiutata");
        },
        onError: (e) =>
          toast.show(
            userErrorMessage(e, "Operazione non riuscita. Riprova."),
            "error"
          ),
      }
    );
  }

  const loading = shiftQuery.isLoading || staffQuery.isLoading;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        onPress={resolve.isPending ? undefined : onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }}
        className="items-center justify-center px-6"
      >
        <Pressable
          onPress={() => {}}
          className="max-h-[80%] w-full rounded-3xl border border-border-2 bg-bg-card p-6"
        >
          <Text className="text-lg font-sans-bold text-t1">
            {isHours ? "Accetti il nuovo orario?" : "Chi copre il turno?"}
          </Text>
          <Text className="mt-2 text-sm leading-5 text-t2">
            {isHours
              ? "Accettare mette l'accordo per iscritto nella chat. L'orario del turno lo aggiorni tu dal pannello: qui non cambia nulla da solo."
              : "Scegli una persona dell'organico, oppure approva lasciando il posto scoperto."}
          </Text>

          {isHours ? null : loading ? (
            <ActivityIndicator color="#EAB54C" className="my-8" />
          ) : candidates.length === 0 ? (
            <Text className="mt-4 text-sm text-t3">
              Nessun altro disponibile in questa sede: puoi approvare lasciando
              il posto scoperto, o rifiutare.
            </Text>
          ) : (
            <ScrollView className="mt-4 max-h-64" keyboardShouldPersistTaps="handled">
              <View className="gap-2">
                {candidates.map((m) => {
                  const on = replacement === m.id;
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => setReplacement(on ? null : m.id)}
                      className={cn(
                        "flex-row items-center gap-3 rounded-2xl border px-3 py-2.5",
                        on
                          ? "border-gold bg-gold/10"
                          : "border-border-2 bg-bg-1"
                      )}
                    >
                      <Avatar
                        uri={m.waiter?.avatar_url ?? undefined}
                        name={m.display_name}
                        size={36}
                      />
                      <View className="flex-1">
                        <Text className="text-[15px] font-sans-semibold text-t1">
                          {m.display_name}
                        </Text>
                        <Text className="text-xs text-t3">
                          {staffRoleNames(m) ?? "Ruoli non indicati"}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          )}

          <View className="mt-6 gap-2.5">
            <GoldButton
              label={
                resolve.isPending
                  ? "Attendere…"
                  : isHours
                    ? "Accetta l'orario"
                    : replacement
                      ? "Approva e sostituisci"
                      : "Approva, resta scoperto"
              }
              disabled={resolve.isPending}
              onPress={() => decide(true)}
            />
            <Pressable
              onPress={() => decide(false)}
              disabled={resolve.isPending}
              className="items-center rounded-xl border border-border py-3.5"
            >
              <Text className="text-sm font-sans-semibold text-t2">
                Rifiuta la richiesta
              </Text>
            </Pressable>
            <Pressable
              onPress={onClose}
              disabled={resolve.isPending}
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
