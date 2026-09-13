import { useState, type ReactNode } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Display } from "@/components/ui/Display";
import { EmptyState } from "@/components/ui/EmptyState";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { InfoRow } from "@/components/ui/InfoRow";
import { Mono } from "@/components/ui/Mono";
import { Pill } from "@/components/ui/Pill";
import { QueryError } from "@/components/ui/QueryError";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/providers/Toast";
import { formatDate, formatShiftRange, isShiftOver } from "@/lib/format";
import { useShiftWithVenue } from "@/features/shifts/hooks";
import { useStartConversation } from "@/features/chat/hooks";
import {
  useMyAssignmentForShift,
  useRespondToAssignment,
} from "@/features/assignments/hooks";
import type { Enums } from "@/types/database";

/** Stato a tutta pagina con back circolare + contenuto centrato (loading/errore/non trovato). */
function GuardScreen({ children }: { children: ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-5">
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          className="h-12 w-12 items-center justify-center rounded-full border border-border-2 bg-bg-2"
        >
          <Icon name="chevL" size={22} color="#F8F4ED" />
        </Pressable>
      </View>
      <View className="flex-1 items-center justify-center px-6">{children}</View>
    </View>
  );
}

const ASSIGN_STATUS_LABEL: Record<Enums<"assignment_status">, string> = {
  assigned: "Da confermare",
  confirmed: "Confermato",
  declined: "Rifiutato",
  no_show: "Assente",
};

export default function WaiterShiftDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const waiterId = session!.user.id;
  const toast = useToast();

  const shiftQuery = useShiftWithVenue(id);
  const shift = shiftQuery.data ?? null;
  const myAssignmentQuery = useMyAssignmentForShift(id, waiterId);
  const myAssignment = myAssignmentQuery.data ?? null;
  const respond = useRespondToAssignment();
  const startConversation = useStartConversation();

  function onContact() {
    const ownerId = shift?.venue?.owner_id;
    if (!ownerId) return;
    startConversation.mutate(
      { waiterId, managerId: ownerId, shiftId: id },
      {
        onSuccess: (conv) => router.push(`/(waiter)/chat/${conv.id}`),
        onError: () => toast.show("Impossibile aprire la chat. Riprova.", "error"),
      }
    );
  }

  const [declineVisible, setDeclineVisible] = useState(false);

  /**
   * A turno concluso non si risponde più.
   *
   * Confermare la presenza a un turno già passato non significa niente, e da
   * 20260913110000 il database lo rifiuta: `freeze_assignment_payroll` congela lo
   * `status` una volta che il turno è finito, perché un `declined` scritto il
   * giorno dopo cancellerebbe ore già lavorate e già viste dal locale. Senza
   * questa guardia i bottoni resterebbero visibili e il tap sarebbe un no-op
   * silenzioso — il modo peggiore di comunicare una regola.
   */
  const isOver = shift ? isShiftOver(shift) : false;

  /** Conferma presenza (o ri-conferma dopo un rifiuto). */
  function onRespond(status: Enums<"assignment_status">) {
    if (!myAssignment) return;
    respond.mutate(
      { id: myAssignment.id, status },
      {
        onSuccess: () =>
          toast.show(
            status === "confirmed" ? "Presenza confermata" : "Turno rifiutato"
          ),
        onError: () => toast.show("Operazione non riuscita. Riprova.", "error"),
      }
    );
  }

  function doDecline() {
    if (!myAssignment) return;
    respond.mutate(
      { id: myAssignment.id, status: "declined" },
      {
        onSuccess: () => {
          setDeclineVisible(false);
          toast.show("Turno rifiutato");
        },
        onError: () => {
          setDeclineVisible(false);
          toast.show("Operazione non riuscita. Riprova.", "error");
        },
      }
    );
  }

  if (shiftQuery.isLoading || myAssignmentQuery.isLoading) {
    return (
      <GuardScreen>
        <ActivityIndicator color="#EAB54C" />
      </GuardScreen>
    );
  }

  if (shiftQuery.isError) {
    return (
      <GuardScreen>
        <QueryError onRetry={() => shiftQuery.refetch()} />
      </GuardScreen>
    );
  }

  if (!shift) {
    return (
      <GuardScreen>
        <EmptyState
          title="Turno non trovato"
          subtitle="Questo turno non è più disponibile."
        />
      </GuardScreen>
    );
  }

  const venueName = shift.venue?.name ?? "Locale";

  return (
    <>
      <ScrollView
        className="flex-1 bg-bg-0"
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 48,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          className="mb-5 h-11 w-11 items-center justify-center rounded-full border border-border-2 bg-bg-2"
        >
          <Icon name="chevL" size={22} color="#F8F4ED" />
        </Pressable>

        <View className="flex-row items-center gap-3.5">
          <View
            style={{
              borderWidth: 2,
              borderColor: "rgba(234,181,76,0.5)",
              borderRadius: 999,
              padding: 2,
            }}
          >
            <Avatar uri={shift.venue?.logo_url} name={venueName} size={52} />
          </View>
          <View className="flex-1">
            <Display className="text-2xl">{venueName}</Display>
            <Text className="mt-0.5 text-sm text-t3">{shift.title}</Text>
          </View>
        </View>

        <Card className="mt-6 rounded-3xl border-border-2 px-5 py-1">
          <InfoRow
            first
            label="Quando"
            value={`${formatDate(shift.date)} · ${formatShiftRange(
              shift.start_time,
              shift.end_time
            )}`}
          />
        </Card>

        {shift.description ? (
          <View className="mt-6">
            <Mono className="mb-2">Descrizione</Mono>
            <Text className="text-sm leading-5 text-t2">{shift.description}</Text>
          </View>
        ) : null}

        <Mono className="mb-3 mt-8">Turno dello staff</Mono>
        {myAssignment ? (
          <Card className="rounded-3xl border-border-2 p-5">
            <Text className="text-sm text-t2">
              Sei stato assegnato a questo turno da {venueName}
              {myAssignment.role ? ` come ${myAssignment.role.name}` : ""}.
            </Text>
            <View className="mt-2 flex-row">
              <Pill
                label={ASSIGN_STATUS_LABEL[myAssignment.status]}
                variant={
                  myAssignment.status === "confirmed"
                    ? "accepted"
                    : myAssignment.status === "declined"
                      ? "cancelled"
                      : "pending"
                }
              />
            </View>
            {isOver ? (
              <Text className="mt-3 text-sm leading-5 text-t3">
                Turno concluso. Le presenze e le ore le registra il locale.
              </Text>
            ) : myAssignment.status === "assigned" ? (
              <View className="mt-4 gap-2.5">
                <GoldButton
                  label={respond.isPending ? "Attendere…" : "Conferma presenza"}
                  disabled={respond.isPending}
                  onPress={() => onRespond("confirmed")}
                />
                <GhostButton
                  label="Non posso"
                  disabled={respond.isPending}
                  onPress={() => setDeclineVisible(true)}
                />
              </View>
            ) : myAssignment.status === "confirmed" ? (
              <Text className="mt-3 text-sm text-t3">
                Hai confermato la presenza. A presto!
              </Text>
            ) : (
              <View className="mt-3 gap-2.5">
                <Text className="text-sm text-t3">
                  Hai rifiutato questo turno.
                </Text>
                <GhostButton
                  label="Ci sono, conferma"
                  disabled={respond.isPending}
                  onPress={() => onRespond("confirmed")}
                />
              </View>
            )}
          </Card>
        ) : (
          <Card className="rounded-3xl border-border-2 p-5">
            <Text className="text-sm text-t3">
              Questo è un turno riservato allo staff del locale.
            </Text>
          </Card>
        )}

        {shift.venue ? (
          <GhostButton
            className="mt-4"
            label={startConversation.isPending ? "Apertura chat…" : "Contatta il locale"}
            disabled={startConversation.isPending}
            onPress={onContact}
          />
        ) : null}
      </ScrollView>

      <ConfirmModal
        visible={declineVisible}
        title="Rifiutare il turno?"
        message="Il locale verrà avvisato."
        confirmLabel="Rifiuta"
        destructive
        pending={respond.isPending}
        onConfirm={doDecline}
        onCancel={() => setDeclineVisible(false)}
      />
    </>
  );
}
