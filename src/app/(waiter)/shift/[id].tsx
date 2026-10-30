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
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import {
  formatBreakMinutes,
  formatDate,
  formatHours,
  formatShiftRange,
  isShiftOver,
} from "@/lib/format";
import { useShiftWithVenue } from "@/features/shifts/hooks";
import { useStartConversation } from "@/features/chat/hooks";
import {
  useMyAssignmentForShift,
  useRespondToAssignment,
} from "@/features/assignments/hooks";
import { DeclineShiftModal } from "@/features/assignments/DeclineShiftModal";
import { ShiftTeamSection } from "@/features/planning/ShiftTeamSection";
import { RequestChangeModal } from "@/features/changeRequests/RequestChangeModal";
import {
  usePendingRequestsForShift,
  useWithdrawShiftChangeRequest,
} from "@/features/changeRequests/hooks";
import {
  HOURS_WITH_CONFIRM_LABEL,
  myPendingRequestText,
  REQUEST_CHANGE_LABEL,
} from "@/features/changeRequests/labels";
import { usePunchClock } from "@/features/clock/hooks";
import {
  clockInNote,
  isClockWindowOpen,
  punchConfirmMessage,
  shiftOverNote,
} from "@/features/clock/availability";
import { ClockBreakButton } from "@/features/clock/ClockBreakButton";
import {
  clockEdit,
  clockEditText,
  clockRecordHours,
  effectiveClockTimes,
  formatClockTime,
  openClockBreak,
} from "@/features/clock/hours";
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
  const punch = usePunchClock();
  const startConversation = useStartConversation();

  function onContact() {
    const workspaceId = shift?.venue?.workspace_id;
    if (!workspaceId) return;
    startConversation.mutate(
      { workspaceId },
      {
        onSuccess: (conv) => router.push(`/(waiter)/chat/${conv.id}`),
        onError: (e) =>
          toast.show(
            userErrorMessage(e, "Impossibile aprire la chat. Riprova."),
            "error"
          ),
      }
    );
  }

  const [declineVisible, setDeclineVisible] = useState(false);
  /**
   * Quale richiesta si sta scrivendo: un cambio su un turno confermato, o la
   * richiesta d'orario che accompagna la conferma («Ci sono, ma a un altro
   * orario»). La finestra si monta solo aperta, così parte dallo stato giusto.
   */
  const [requestMode, setRequestMode] = useState<"change" | "withConfirm" | null>(
    null
  );
  const [punchAction, setPunchAction] = useState<"in" | "out" | null>(null);

  // La RLS filtra già: qui torna solo la **propria** richiesta aperta.
  const pendingRequest = usePendingRequestsForShift(id).data?.[0] ?? null;
  const withdraw = useWithdrawShiftChangeRequest();

  /**
   * Ritirare dal turno, non solo dalla card in chat: è qui che si guarda la
   * richiesta in attesa. Senza conferma, come nella card: ritirarla per sbaglio
   * costa una richiesta nuova.
   */
  function onWithdraw() {
    if (!pendingRequest) return;
    withdraw.mutate(pendingRequest.id, {
      onSuccess: () => toast.show("Richiesta ritirata"),
      onError: (e) =>
        toast.show(userErrorMessage(e, "Operazione non riuscita. Riprova."), "error"),
    });
  }

  /**
   * A turno concluso non si risponde più.
   *
   * Confermare la presenza a un turno già passato non significa niente, e da
   * 20260913110000 il database lo rifiuta: `freeze_assignment_payroll` congela lo
   * `status` una volta che il turno è finito, perché un `declined` scritto il
   * giorno dopo cancellerebbe ore già lavorate e già viste dalla sede. Senza
   * questa guardia i bottoni resterebbero visibili e il tap sarebbe un no-op
   * silenzioso — il modo peggiore di comunicare una regola.
   */
  const isOver = shift ? isShiftOver(shift) : false;

  /** Conferma presenza (o ri-conferma dopo un rifiuto). */
  function onRespond(
    status: Extract<Enums<"assignment_status">, "confirmed" | "declined">
  ) {
    if (!myAssignment) return;
    respond.mutate(
      { id: myAssignment.id, status },
      {
        onSuccess: () =>
          toast.show(
            status === "confirmed" ? "Presenza confermata" : "Turno rifiutato"
          ),
        onError: (e) =>
          toast.show(userErrorMessage(e, "Operazione non riuscita. Riprova."), "error"),
      }
    );
  }

  /**
   * «Ci sono, ma a un altro orario»: la richiesta è partita, ora la conferma.
   * Prima la richiesta perché è lei la cosa che conta: se fallisce non è
   * cambiato niente; se fallisce la conferma, la richiesta c'è e lo si dice.
   */
  function confirmAfterHoursRequest() {
    if (!myAssignment) return;
    respond.mutate(
      { id: myAssignment.id, status: "confirmed" },
      {
        onSuccess: () =>
          toast.show("Presenza confermata e richiesta d'orario inviata"),
        onError: () =>
          toast.show(
            "Richiesta inviata, ma la presenza non è confermata: tocca «Conferma presenza».",
            "error"
          ),
      }
    );
  }

  function doPunch() {
    if (!myAssignment || !punchAction) return;
    const action = punchAction;
    punch.mutate(
      { assignmentId: myAssignment.id, action },
      {
        onSuccess: () => {
          setPunchAction(null);
          toast.show(action === "in" ? "Entrata registrata" : "Uscita registrata");
        },
        onError: (e) => {
          setPunchAction(null);
          toast.show(userErrorMessage(e, "Impossibile timbrare. Riprova."), "error");
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

  const venueName = shift.venue?.name ?? "Sede";
  // Annullare un turno non toglie le assegnazioni: il turno resta leggibile, e
  // qui deve dirlo invece di offrire una conferma che il server rifiuterebbe.
  const cancelled = shift.status === "cancelled";
  const clock = myAssignment?.clock ?? null;
  const clockTimes = clock ? effectiveClockTimes(clock) : null;
  const openPause = clock ? openClockBreak(clock) : null;
  const clockHours = clock ? clockRecordHours(clock, shift) : null;
  // Orari inseriti o corretti dalla sede: si mostrano quelli corretti, e questa
  // riga dice da dove vengono e cosa si era timbrato.
  const editNote = clock ? clockEditText(clockEdit(clock)) : null;
  const clockMethod = myAssignment?.clock_method ?? shift.venue?.clock_method ?? "manual";
  const canClock =
    !!myAssignment &&
    shift.status !== "cancelled" &&
    myAssignment.status !== "declined" &&
    myAssignment.status !== "no_show";
  const clockWindowOpen = isClockWindowOpen(shift);
  // Senza timbratura: il pulsante d'entrata (da un'ora prima dell'inizio alla
  // fine, come in Home) o la frase che dice perché non c'è.
  const inNote = clockInNote(shift, clockMethod);

  return (
    <View className="flex-1 bg-bg-0">
      {/* Un'unica riga in alto, come `ScreenHeader`: indietro, sede, turno. */}
      <View
        className="shrink-0 flex-row items-center gap-3 px-5 pb-5"
        style={{ paddingTop: insets.top + 8 }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          className="h-11 w-11 items-center justify-center rounded-full border border-border-2 bg-bg-2"
        >
          <Icon name="chevL" size={22} color="#F8F4ED" />
        </Pressable>
        <View
          style={{
            borderWidth: 2,
            borderColor: "rgba(234,181,76,0.5)",
            borderRadius: 999,
            padding: 2,
          }}
        >
          <Avatar uri={shift.venue?.logo_url} name={venueName} size={40} />
        </View>
        <View className="flex-1">
          <Display className="text-xl" numberOfLines={1}>
            {venueName}
          </Display>
          <Text className="text-sm text-t3" numberOfLines={1}>
            {shift.title}
          </Text>
        </View>
      </View>

      <ScrollView
        className="flex-1 bg-bg-0"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 48,
        }}
      >
        <Card className="rounded-3xl border-border-2 px-5 py-1">
          <InfoRow
            first
            label="Quando"
            value={`${formatDate(shift.date)} · ${formatShiftRange(
              shift.start_time,
              shift.end_time
            )}`}
          />
          {/* Quanto dura e basta: se è retribuita lo decide la sede. */}
          {shift.break_minutes > 0 ? (
            <InfoRow
              label="Pausa"
              value={formatBreakMinutes(shift.break_minutes)}
            />
          ) : null}
        </Card>

        {shift.description ? (
          <View className="mt-6">
            <Mono className="mb-2">Descrizione</Mono>
            <Text className="text-sm leading-5 text-t2">{shift.description}</Text>
          </View>
        ) : null}

        <Mono className="mb-3 mt-8">Il tuo turno</Mono>
        {myAssignment ? (
          <Card className="rounded-3xl border-border-2 p-5">
            <Text className="text-sm text-t2">
              {venueName} ti ha messo in questo turno
              {myAssignment.role ? ` come ${myAssignment.role.name}` : ""}.
            </Text>
            <View className="mt-2 flex-row">
              <Pill
                label={
                  cancelled ? "Annullato" : ASSIGN_STATUS_LABEL[myAssignment.status]
                }
                variant={
                  cancelled || myAssignment.status === "declined"
                    ? "cancelled"
                    : myAssignment.status === "confirmed"
                      ? "accepted"
                      : "pending"
                }
              />
            </View>
            {cancelled ? (
              <Text className="mt-3 text-sm leading-5 text-t3">
                {venueName} ha annullato questo turno: non devi presentarti.
              </Text>
            ) : isOver ? (
              <Text className="mt-3 text-sm leading-5 text-t3">
                {shiftOverNote(shift, clockMethod, clock)}
              </Text>
            ) : myAssignment.status === "assigned" ? (
              <View className="mt-4 gap-2.5">
                <GoldButton
                  label={respond.isPending ? "Attendere…" : "Conferma presenza"}
                  disabled={respond.isPending}
                  onPress={() => onRespond("confirmed")}
                />
                {/* Chi può venire ma su un altro orario non deve prima
                    impegnarsi sull'orario intero: la richiesta parte con la
                    conferma. Il server la accetta anche da confermare. */}
                {pendingRequest ? (
                  <Text className="text-sm leading-5 text-gold">
                    {myPendingRequestText(pendingRequest)}
                  </Text>
                ) : (
                  <GhostButton
                    label={HOURS_WITH_CONFIRM_LABEL}
                    disabled={respond.isPending}
                    onPress={() => setRequestMode("withConfirm")}
                  />
                )}
                <GhostButton
                  label="Non posso"
                  disabled={respond.isPending}
                  onPress={() => setDeclineVisible(true)}
                />
              </View>
            ) : myAssignment.status === "confirmed" ? (
              <View className="mt-3 gap-2.5">
                <Text className="text-sm text-t3">
                  {/* `confirmed_at` null = non ha confermato nessuno: è un
                      dipendente fisso, per cui il turno è già suo (migration
                      20260915100000). Dirgli "hai confermato" sarebbe falso. */}
                  {myAssignment.confirmed_at
                    ? "Hai confermato la presenza. A presto!"
                    : "Sei in turno. Non serve confermare."}
                </Text>
                {/* Dopo la conferma il turno non si molla da soli: la sede ci
                    ha pianificato sopra. Resta la richiesta di cambio
                    (sostituzione o orario diverso), che decide la sede. Per il
                    dipendente fisso è l'unica via d'uscita. */}
                {pendingRequest ? (
                  <>
                    <Text className="text-sm leading-5 text-gold">
                      {myPendingRequestText(pendingRequest)}
                    </Text>
                    {/* La card della richiesta sta nel thread col titolare,
                        lo stesso che apre «Contatta la sede». */}
                    <View className="flex-row gap-2">
                      <GhostButton
                        className="flex-1"
                        size="sm"
                        label={withdraw.isPending ? "Attendere…" : "Ritira la richiesta"}
                        disabled={withdraw.isPending}
                        onPress={onWithdraw}
                      />
                      <GhostButton
                        className="flex-1"
                        size="sm"
                        label="Vedi in chat"
                        disabled={startConversation.isPending}
                        onPress={onContact}
                      />
                    </View>
                  </>
                ) : (
                  <GhostButton
                    label={REQUEST_CHANGE_LABEL}
                    onPress={() => setRequestMode("change")}
                  />
                )}
              </View>
            ) : (
              <View className="mt-3 gap-2.5">
                <Text className="text-sm leading-5 text-t3">
                  {myAssignment.decline_reason
                    ? `Hai rifiutato questo turno: «${myAssignment.decline_reason}».`
                    : "Hai rifiutato questo turno."}{" "}
                  Se ci ripensi, la sede viene avvisata.
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
              Non sei in questo turno.
            </Text>
          </Card>
        )}

        {myAssignment && canClock ? (
          <View className="mt-8">
            <Mono className="mb-3">Timbratura</Mono>
            <Card className="rounded-3xl border-border-2 p-5">
              {clockTimes ? (
                clockTimes.outAt ? (
                  <>
                    <Text className="text-base font-sans-semibold text-t1">
                      {formatClockTime(clockTimes.inAt)}–{formatClockTime(clockTimes.outAt)}
                    </Text>
                    <Text className="mt-1 text-sm text-t3">
                      {formatHours(clockHours ?? 0)} · {myAssignment.attendance_reviewed_at
                        ? "ore approvate"
                        : "in attesa di verifica"}
                    </Text>
                    {editNote ? (
                      <Text className="mt-2 text-xs leading-4 text-t3">{editNote}</Text>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Text className="text-sm text-t2">
                      In servizio dalle {formatClockTime(clockTimes.inAt)}
                      {openPause
                        ? ` · in pausa dalle ${formatClockTime(openPause.started_at)}`
                        : ""}
                    </Text>
                    {editNote ? (
                      <Text className="mt-2 text-xs leading-4 text-t3">{editNote}</Text>
                    ) : null}
                    {clockWindowOpen && clock ? (
                      openPause ? (
                        <>
                          <ClockBreakButton className="mt-4" recordId={clock.id} onBreak />
                          <GhostButton
                            className="mt-3"
                            label={punch.isPending ? "Registrazione…" : "Timbra uscita"}
                            disabled={punch.isPending}
                            onPress={() => setPunchAction("out")}
                          />
                        </>
                      ) : (
                        <>
                          <GoldButton
                            className="mt-4"
                            label={punch.isPending ? "Registrazione…" : "Timbra uscita"}
                            disabled={punch.isPending}
                            onPress={() => setPunchAction("out")}
                          />
                          {/* Pausa fissa: vale quella del turno, niente pulsante. */}
                          {clock.break_clocked ? (
                            <ClockBreakButton
                              className="mt-3"
                              recordId={clock.id}
                              onBreak={false}
                            />
                          ) : null}
                        </>
                      )
                    ) : (
                      <Text className="mt-2 text-sm text-error">
                        Ormai è tardi per timbrare l’uscita dall’app: chiedi alla sede di inserirla.
                      </Text>
                    )}
                  </>
                )
              ) : inNote.kind === "button" ? (
                <>
                  <Text className="text-sm leading-5 text-t3">
                    Le ore partono da quando timbri; la sede le verifica.
                  </Text>
                  <GoldButton
                    className="mt-4"
                    label={punch.isPending ? "Registrazione…" : "Timbra entrata"}
                    disabled={punch.isPending}
                    onPress={() => setPunchAction("in")}
                  />
                </>
              ) : (
                <Text className="text-sm leading-5 text-t3">{inNote.text}</Text>
              )}
            </Card>
          </View>
        ) : null}

        {/* Sotto l'azione, non sopra: la schermata esiste per confermare la
            presenza, e la squadra è il contesto di quel gesto. Si toglie da sé
            quando si è da soli o quando la sede non condivide il planning. */}
        {cancelled ? null : (
          <ShiftTeamSection
            className="mt-8"
            shiftId={shift.id}
            date={shift.date}
          />
        )}

        {shift.venue ? (
          <GhostButton
            className="mt-4"
            label={startConversation.isPending ? "Apertura chat…" : "Contatta la sede"}
            disabled={startConversation.isPending}
            onPress={onContact}
          />
        ) : null}
      </ScrollView>

      <DeclineShiftModal
        assignmentId={declineVisible && myAssignment ? myAssignment.id : null}
        onClose={() => setDeclineVisible(false)}
      />

      <ConfirmModal
        visible={punchAction != null}
        title={punchAction === "out" ? "Timbrare l’uscita?" : "Timbrare l’entrata?"}
        message={punchAction ? punchConfirmMessage(punchAction, shift) : ""}
        confirmLabel={punchAction === "out" ? "Timbra uscita" : "Timbra entrata"}
        pending={punch.isPending}
        onConfirm={doPunch}
        onCancel={() => setPunchAction(null)}
      />

      {myAssignment && requestMode ? (
        <RequestChangeModal
          visible
          assignmentId={myAssignment.id}
          shiftLabel={formatDate(shift.date)}
          shiftStart={shift.start_time}
          shiftEnd={shift.end_time}
          withConfirm={requestMode === "withConfirm"}
          onSent={requestMode === "withConfirm" ? confirmAfterHoursRequest : undefined}
          onClose={() => setRequestMode(null)}
        />
      ) : null}
    </View>
  );
}
