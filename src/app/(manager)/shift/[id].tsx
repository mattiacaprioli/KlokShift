import { useState, type ReactNode } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { InfoRow } from "@/components/ui/InfoRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { Mono } from "@/components/ui/Mono";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { QueryError } from "@/components/ui/QueryError";
import { Pill } from "@/components/ui/Pill";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useToast } from "@/providers/Toast";
import { cn } from "@/lib/cn";
import {
  formatDate,
  formatHours,
  formatShiftRange,
  isShiftOver,
  shiftDurationHours,
} from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { useShift, useUpdateShiftStatus } from "@/features/shifts/hooks";
import { useStartConversation } from "@/features/chat/hooks";
import {
  useSetAssignmentPresence,
  useShiftAssignments,
  useShiftRoleRequirements,
} from "@/features/assignments/hooks";
import { usePendingRequestsForShift } from "@/features/changeRequests/hooks";
import { isWorked } from "@/features/assignments/hours";
import { computeCoverage } from "@/features/assignments/coverage";
import { ASSIGNMENT_STATUS_LABEL } from "@/features/assignments/status";
import type { AssignmentWithStaff } from "@/features/assignments/api";
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

const SHIFT_STATUS_LABEL: Record<Enums<"shift_status">, string> = {
  open: "Aperto",
  closed: "Chiuso",
  cancelled: "Annullato",
};

/** Riga staff assegnato a un turno interno (vista ristoratore). */
function AssignedRow({
  assignment,
  onPress,
  onMessage,
  changeRequested,
}: {
  assignment: AssignmentWithStaff;
  onPress?: () => void;
  onMessage?: () => void;
  /** Ha chiesto di essere sostituito: la richiesta si legge e si decide in chat. */
  changeRequested?: boolean;
}) {
  const sm = assignment.staff_member;
  const name = sm?.display_name ?? "Staff";
  return (
    <Card className="rounded-3xl border-border-2 p-4" onPress={onPress}>
      <View className="flex-row items-center gap-3">
        <Avatar uri={sm?.waiter?.avatar_url ?? undefined} name={name} size={44} />
        <View className="flex-1">
          <View className="flex-row items-center gap-1.5">
            <Text className="text-base font-sans-bold text-t1">{name}</Text>
            {sm?.waiter_id ? (
              <Icon name="verified" size={15} color="#EAB54C" />
            ) : null}
          </View>
          <Text className="text-xs text-t3">
            {assignment.role?.name ?? "Ruolo da assegnare"}
          </Text>
          {changeRequested ? (
            <Text className="text-xs font-sans-semibold text-gold">
              Ha chiesto il cambio · rispondi in chat
            </Text>
          ) : null}
        </View>
        <Pill
          label={ASSIGNMENT_STATUS_LABEL[assignment.status]}
          variant={assignment.status === "declined" ? "cancelled" : "neutral"}
        />
        {onMessage ? (
          <Pressable
            hitSlop={8}
            onPress={onMessage}
            className="h-10 w-10 items-center justify-center rounded-full border border-border-2 bg-bg-2"
          >
            <Icon name="message" size={16} color="#EAB54C" />
          </Pressable>
        ) : null}
        {onPress ? <Icon name="chevR" size={18} color="#8c857a" /> : null}
      </View>
    </Card>
  );
}

/** Riga presenza per un turno interno concluso: presente/assente + ore effettive. */
function PresenceRow({
  assignment,
  plannedHours,
  shiftId,
}: {
  assignment: AssignmentWithStaff;
  plannedHours: number;
  shiftId: string;
}) {
  const presence = useSetAssignmentPresence(shiftId);
  const sm = assignment.staff_member;
  const name = sm?.display_name ?? "Staff";
  const present = isWorked(assignment.status);
  const effective = present ? (assignment.worked_hours ?? plannedHours) : 0;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(plannedHours);

  function setPresent(p: boolean) {
    presence.mutate({ id: assignment.id, status: p ? "confirmed" : "no_show" });
    if (!p) setEditing(false);
  }
  function step(delta: number) {
    setDraft((d) => Math.max(0, Math.min(24, Math.round((d + delta) * 2) / 2)));
  }
  function saveHours() {
    presence.mutate(
      { id: assignment.id, worked_hours: draft },
      { onSuccess: () => setEditing(false) }
    );
  }
  function resetPlanned() {
    presence.mutate(
      { id: assignment.id, worked_hours: null },
      { onSuccess: () => setEditing(false) }
    );
  }

  return (
    <Card className="rounded-3xl border-border-2 p-4">
      <View className="flex-row items-center gap-3">
        <Avatar uri={sm?.waiter?.avatar_url ?? undefined} name={name} size={44} />
        <View className="flex-1">
          <Text className="text-base font-sans-bold text-t1">{name}</Text>
          <Text className="text-xs text-t3">
            {assignment.role?.name ?? "Ruolo da assegnare"}
          </Text>
        </View>
        <View className="flex-row overflow-hidden rounded-full border border-border">
          <Pressable
            disabled={presence.isPending}
            onPress={() => setPresent(true)}
            className={cn("px-3 py-1.5", present && "bg-gold")}
          >
            <Text
              className={cn(
                "text-xs font-sans-semibold",
                present ? "text-gold-ink" : "text-t3"
              )}
            >
              Presente
            </Text>
          </Pressable>
          <Pressable
            disabled={presence.isPending}
            onPress={() => setPresent(false)}
            className={cn("px-3 py-1.5", !present && "bg-error")}
          >
            <Text
              className="text-xs font-sans-semibold"
              style={{ color: !present ? "#FFFFFF" : "#8c857a" }}
            >
              Assente
            </Text>
          </Pressable>
        </View>
      </View>

      {present ? (
        <View className="mt-3 border-t border-border pt-3">
          {!editing ? (
            <Pressable
              onPress={() => {
                setDraft(effective);
                setEditing(true);
              }}
              className="flex-row items-center justify-between"
            >
              <View className="flex-row items-center gap-2">
                <Icon name="clock" size={15} color="#8c857a" />
                <Text className="text-sm text-t2">Ore: {formatHours(effective)}</Text>
                {assignment.worked_hours != null ? (
                  <Text className="text-[11px] text-t4">· modificate</Text>
                ) : null}
              </View>
              <Text className="text-sm font-sans-semibold text-gold">Modifica</Text>
            </Pressable>
          ) : (
            <View className="gap-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-t2">Ore effettive</Text>
                <View className="flex-row items-center gap-4">
                  <Pressable
                    onPress={() => step(-0.5)}
                    hitSlop={8}
                    className="h-9 w-9 items-center justify-center rounded-full border border-border-2 bg-bg-2"
                  >
                    <Text className="text-lg text-t1">−</Text>
                  </Pressable>
                  <Text className="w-16 text-center font-sans-semibold text-base text-t1">
                    {formatHours(draft)}
                  </Text>
                  <Pressable
                    onPress={() => step(0.5)}
                    hitSlop={8}
                    className="h-9 w-9 items-center justify-center rounded-full border border-border-2 bg-bg-2"
                  >
                    <Text className="text-lg text-t1">+</Text>
                  </Pressable>
                </View>
              </View>
              <View className="flex-row gap-2.5">
                <Pressable
                  disabled={presence.isPending}
                  onPress={resetPlanned}
                  className="flex-1 items-center rounded-2xl border border-border-2 py-2.5"
                >
                  <Text className="text-sm font-sans-semibold text-t2">
                    Pianificate
                  </Text>
                </Pressable>
                <Pressable
                  disabled={presence.isPending}
                  onPress={saveHours}
                  className="flex-1 items-center rounded-2xl bg-gold py-2.5"
                >
                  <Text className="text-sm font-sans-semibold text-gold-ink">
                    Salva
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      ) : null}
    </Card>
  );
}

export default function ShiftDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const managerId = session!.user.id;
  const startConversation = useStartConversation();

  const shiftQuery = useShift(id);
  const shift = shiftQuery.data ?? null;
  const assignmentsQuery = useShiftAssignments(id);
  const assignments = assignmentsQuery.data ?? [];
  const roleReqsQuery = useShiftRoleRequirements(id);
  const roleRequirements = roleReqsQuery.data ?? [];

  // Chi ha chiesto di essere sostituito. La decisione si prende in chat, dove
  // c'è il motivo: qui è solo il segnale che da qualche parte c'è una risposta
  // da dare — senza, il titolare la vedrebbe solo se apre il thread.
  const requestedAssignmentIds = new Set(
    (usePendingRequestsForShift(id).data ?? [])
      .map((r) => r.assignment_id)
      .filter((x): x is string => !!x)
  );

  const statusMutation = useUpdateShiftStatus(id);
  const busy = statusMutation.isPending;
  const [cancelVisible, setCancelVisible] = useState(false);
  const [restoreVisible, setRestoreVisible] = useState(false);

  function onCancelShift() {
    statusMutation.mutate("cancelled", {
      onSuccess: () => {
        setCancelVisible(false);
        toast.show("Turno annullato");
      },
      onError: () => {
        setCancelVisible(false);
        toast.show("Operazione non riuscita.", "error");
      },
    });
  }

  function onRestoreShift() {
    statusMutation.mutate("open", {
      onSuccess: () => {
        setRestoreVisible(false);
        toast.show("Turno ripristinato");
      },
      onError: () => {
        setRestoreVisible(false);
        toast.show("Operazione non riuscita.", "error");
      },
    });
  }

  function onChangeShiftStatus(status: Enums<"shift_status">) {
    statusMutation.mutate(status, {
      onSuccess: () => toast.show("Turno aggiornato"),
      onError: () => toast.show("Operazione non riuscita.", "error"),
    });
  }

  function onMessage(waiterId: string) {
    startConversation.mutate(
      { waiterId, managerId, shiftId: id },
      {
        onSuccess: (conv) => router.push(`/(manager)/chat/${conv.id}`),
        onError: () => toast.show("Impossibile aprire la chat. Riprova.", "error"),
      }
    );
  }

  if (shiftQuery.isLoading) {
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

  // A turno finito (non a mezzanotte) si passa dalla vista "staff assegnato"
  // a quella delle presenze.
  const isPast = isShiftOver(shift);
  const plannedHours = shiftDurationHours(shift.start_time, shift.end_time);
  // A consuntivo si segna solo chi il turno l'ha accettato: un rifiuto non è
  // un'assenza, e nella riga presenza si leggerebbe come tale.
  const presenceRows = assignments.filter((a) => a.status !== "declined");
  const staffRows = isPast ? presenceRows : assignments;
  const roleCoverage = computeCoverage(
    roleRequirements.map((r) => ({
      role_id: r.role_id,
      role: r.role?.name ?? "Ruolo",
      count: r.count,
    })),
    assignments.map((a) => ({ status: a.status, role_id: a.role_id }))
  );

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
      <ScreenHeader
        eyebrow="Turno"
        title={shift.title}
        right={
          <Pill
            label={SHIFT_STATUS_LABEL[shift.status]}
            variant={shift.status}
          />
        }
      />

      <Card className="mt-6 rounded-3xl border-border-2 px-5 py-1">
        <InfoRow
          first
          label="Quando"
          value={`${formatDate(shift.date)} · ${formatShiftRange(
            shift.start_time,
            shift.end_time
          )}`}
        />
        <InfoRow
          label="Staff"
          value={`${assignments.length} assegnat${assignments.length === 1 ? "o" : "i"}`}
        />
      </Card>

      {shift.description ? (
        <View className="mt-6">
          <Mono className="mb-2">Descrizione</Mono>
          <Text className="text-sm leading-5 text-t2">{shift.description}</Text>
        </View>
      ) : null}

      {/* Azioni turno */}
      <View className="mt-6 gap-2.5">
        {shift.status === "open" ? (
          <View className="flex-row gap-2.5">
            <Pressable
              disabled={busy}
              onPress={() => onChangeShiftStatus("closed")}
              className="flex-1 items-center rounded-2xl border border-border-2 bg-bg-2 py-3.5"
            >
              <Text className="text-sm font-sans-semibold text-t1">
                Chiudi turno
              </Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => setCancelVisible(true)}
              className="flex-1 items-center rounded-2xl border border-border-2 py-3.5"
            >
              <Text className="text-sm font-sans-semibold text-error">
                Annulla
              </Text>
            </Pressable>
          </View>
        ) : shift.status === "closed" ? (
          <Pressable
            disabled={busy}
            onPress={() => onChangeShiftStatus("open")}
            className="items-center rounded-2xl border border-border-2 bg-bg-2 py-3.5"
          >
            <Text className="text-sm font-sans-semibold text-t1">
              Riapri turno
            </Text>
          </Pressable>
        ) : (
          /* Annullato: senza questo, un tocco sbagliato costava il turno — si
             poteva solo ricrearlo da zero e riassegnare tutti. */
          <Pressable
            disabled={busy}
            onPress={() => setRestoreVisible(true)}
            className="items-center rounded-2xl border border-border-2 bg-bg-2 py-3.5"
          >
            <Text className="text-sm font-sans-semibold text-gold">
              Ripristina turno
            </Text>
          </Pressable>
        )}

        {!isPast && shift.status !== "cancelled" ? (
          <Pressable
            disabled={busy}
            onPress={() => router.push(`/(manager)/shift/edit/${id}`)}
            className="items-center rounded-2xl border border-border-2 bg-bg-2 py-3.5"
          >
            <Text className="text-sm font-sans-semibold text-gold">
              Modifica turno
            </Text>
          </Pressable>
        ) : null}
      </View>

      {roleRequirements.length > 0 ? (
        <View className="mt-8 gap-3">
          <Mono>Copertura</Mono>
          {roleCoverage.rows.map((row) => {
            const short = row.required - row.covered;
            return (
              <View
                key={row.role}
                className="gap-2 rounded-2xl border border-border bg-bg-card px-4 py-3"
              >
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-sans-semibold text-t1">
                    {row.role}
                  </Text>
                  {short > 0 ? (
                    <Pill label={`manca ${short}`} variant="pending" icon="alert" />
                  ) : (
                    <Text className="text-sm font-sans-semibold text-success">
                      Completo
                    </Text>
                  )}
                </View>
                <ProgressBar
                  progress={
                    row.required > 0
                      ? Math.min(1, row.covered / row.required)
                      : 0
                  }
                />
                <Text className="text-xs text-t3">
                  {row.covered}/{row.required} coperti
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <View className="mt-8 gap-3">
        <Mono>{isPast ? "Presenze" : "Staff assegnato"}</Mono>
          {isPast ? (
            <Text className="-mt-1 text-xs text-t3">
              Segna chi ha svolto il turno e correggi le ore se serve.
            </Text>
          ) : null}
          {assignmentsQuery.isError ? (
            <QueryError
              onRetry={() => assignmentsQuery.refetch()}
              subtitle="Non siamo riusciti a caricare lo staff. Riprova."
            />
          ) : staffRows.length === 0 ? (
            <EmptyState
              title={isPast ? "Nessuna presenza" : "Nessuno assegnato"}
              subtitle={
                isPast
                  ? "Chi era assegnato ha rifiutato il turno."
                  : "Questo turno non ha ancora nessuno dello staff."
              }
            />
          ) : isPast ? (
            presenceRows.map((a) => (
              <PresenceRow
                key={a.id}
                assignment={a}
                plannedHours={plannedHours}
                shiftId={id}
              />
            ))
          ) : (
            assignments.map((a) => {
              const waiterId = a.staff_member?.waiter_id ?? null;
              return (
                <AssignedRow
                  key={a.id}
                  assignment={a}
                  onPress={
                    waiterId
                      ? () => router.push(`/(manager)/cameriere/${waiterId}`)
                      : undefined
                  }
                  onMessage={waiterId ? () => onMessage(waiterId) : undefined}
                  changeRequested={requestedAssignmentIds.has(a.id)}
                />
              );
            })
          )}
      </View>
    </ScrollView>

    <ConfirmModal
      visible={cancelVisible}
      title="Annullare il turno?"
      message="I professionisti coinvolti ricevono una notifica e il turno sparisce dalle loro viste. Potrai ripristinarlo da qui."
      confirmLabel="Annulla turno"
      cancelLabel="Indietro"
      destructive
      pending={statusMutation.isPending}
      onConfirm={onCancelShift}
      onCancel={() => setCancelVisible(false)}
    />

    <ConfirmModal
      visible={restoreVisible}
      title="Ripristinare il turno?"
      message="Torna attivo con le persone che erano assegnate, e ognuna riceve una notifica."
      confirmLabel="Ripristina turno"
      cancelLabel="Indietro"
      pending={statusMutation.isPending}
      onConfirm={onRestoreShift}
      onCancel={() => setRestoreVisible(false)}
    />
    </>
  );
}
