import { useState } from "react";
import { Modal, ScrollView } from "react-native";
import { Pressable, Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import { TimeField } from "@/features/shifts/TimeField";
import type { AssignmentWithStaff } from "@/features/assignments/api";
import { userErrorMessage } from "@/lib/errors";
import { formatHours, formatHoursVariance } from "@/lib/format";
import { useToast } from "@/providers/Toast";
import {
  useApproveClockRecord,
  useCorrectClockRecord,
  useVoidClockRecord,
} from "./hooks";
import { clockedHours, effectiveClockTimes, formatClockTime } from "./hours";

type EditMode = "correct" | "void" | null;

function formatCorrectionDate(value: string): string {
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Rome",
  }).format(new Date(value));
}

/**
 * Revisione mobile di una timbratura nel consuntivo del turno.
 *
 * La correzione non sovrascrive mai il record: passa dalla RPC append-only e
 * richiede sempre un motivo. Anche l'annullamento resta tracciato dal server.
 */
export function ManagerClockReview({
  assignment,
  scheduledOutAt,
  plannedHours,
  locked = false,
}: {
  assignment: AssignmentWithStaff;
  /** Fine pianificata del turno, proposta quando manca l'uscita. */
  scheduledOutAt: Date;
  /** Le ore del turno: lo scostamento si legge accanto a quelle timbrate. */
  plannedHours: number;
  locked?: boolean;
}) {
  const toast = useToast();
  const approve = useApproveClockRecord();
  const correct = useCorrectClockRecord();
  const voidClock = useVoidClockRecord();
  const clock = assignment.clock;
  const times = clock ? effectiveClockTimes(clock) : null;
  const personName = assignment.staff_member?.display_name ?? "Il professionista";
  const [mode, setMode] = useState<EditMode>(null);
  const [inAt, setInAt] = useState(() => new Date());
  const [outAt, setOutAt] = useState(() => scheduledOutAt);
  const [reason, setReason] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  if (!clock || !times) {
    return (
      <View className="mt-3 border-t border-border pt-3">
        <Text className="text-xs text-t4">Nessuna timbratura registrata</Text>
      </View>
    );
  }

  // Alias non-null stabili anche dentro i callback asincroni.
  const activeClock = clock;
  const activeTimes = times;
  const hours = activeTimes.outAt
    ? clockedHours(activeTimes.inAt, activeTimes.outAt)
    : null;
  const delta = hours != null ? formatHoursVariance(hours - plannedHours) : null;
  const reviewed = assignment.attendance_reviewed_at != null;
  const pending = approve.isPending || correct.isPending || voidClock.isPending;
  const invalidRange = outAt.getTime() <= inAt.getTime();
  const canSaveCorrection =
    reason.trim().length > 0 && !invalidRange && !pending;
  const corrections = [...activeClock.corrections].sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  );

  function closeEditor() {
    if (pending) return;
    setMode(null);
    setReason("");
  }

  function openCorrection() {
    setInAt(new Date(activeTimes.inAt));
    setOutAt(
      activeTimes.outAt
        ? new Date(activeTimes.outAt)
        : new Date(scheduledOutAt)
    );
    setReason("");
    setMode("correct");
  }

  function onApprove() {
    approve.mutate(assignment.id, {
      onSuccess: () => toast.show("Ore timbrate approvate"),
      onError: (error) =>
        toast.show(
          userErrorMessage(error, "Impossibile approvare le ore."),
          "error"
        ),
    });
  }

  function onCorrect() {
    if (!canSaveCorrection) return;
    correct.mutate(
      {
        recordId: activeClock.id,
        inAt: inAt.toISOString(),
        outAt: outAt.toISOString(),
        reason: reason.trim(),
      },
      {
        onSuccess: () => {
          setMode(null);
          setReason("");
          toast.show(
            activeTimes.outAt ? "Orari corretti" : "Uscita inserita"
          );
        },
        onError: (error) =>
          toast.show(
            userErrorMessage(error, "Impossibile salvare la correzione."),
            "error"
          ),
      }
    );
  }

  function onVoid() {
    const cleanReason = reason.trim();
    if (!cleanReason || pending) return;
    voidClock.mutate(
      { assignmentId: assignment.id, reason: cleanReason },
      {
        onSuccess: () => {
          setMode(null);
          setReason("");
          toast.show("Timbratura annullata");
        },
        onError: (error) =>
          toast.show(
            userErrorMessage(error, "Impossibile annullare la timbratura."),
            "error"
          ),
      }
    );
  }

  return (
    <>
      <View className="mt-3 rounded-2xl border border-border bg-bg-1 p-3.5">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1 flex-row items-center gap-2">
            <View className="h-9 w-9 items-center justify-center rounded-full bg-bg-2">
              <Icon name="clock" size={17} color="#EAB54C" />
            </View>
            <View className="flex-1">
              <Text className="text-xs font-sans-semibold uppercase tracking-wider text-t3">
                Timbratura
              </Text>
              <Text className="mt-0.5 text-sm font-sans-semibold text-t1">
                {formatClockTime(activeTimes.inAt)} –{" "}
                {activeTimes.outAt
                  ? formatClockTime(activeTimes.outAt)
                  : "uscita mancante"}
              </Text>
              {hours != null ? (
                <Text className="mt-0.5 text-xs text-t3">
                  Totale proposto: {formatHours(hours)}
                  {delta ? (
                    <Text className="font-sans-semibold text-warning">
                      {" "}
                      · {delta} sul turno
                    </Text>
                  ) : null}
                </Text>
              ) : null}
            </View>
          </View>
          <Pill
            label={reviewed ? "Approvato" : "Da verificare"}
            variant={reviewed ? "accepted" : "pending"}
          />
        </View>

        {!activeTimes.outAt ? (
          <View className="mt-3 rounded-xl bg-warning/10 px-3 py-2.5">
            <Text className="text-xs leading-4 text-warning">
              {personName} ha timbrato l’entrata, ma non l’uscita. Inseriscila
              prima di approvare le ore.
            </Text>
          </View>
        ) : null}

        {!locked ? (
          <View className="mt-3 gap-2">
            {!reviewed && activeTimes.outAt ? (
              <GoldButton
                label={
                  pending
                    ? "Attendere…"
                    : hours != null
                      ? `Approva ${formatHours(hours)}`
                      : "Approva"
                }
                size="sm"
                disabled={pending}
                onPress={onApprove}
              />
            ) : null}
            <Pressable
              disabled={pending}
              onPress={openCorrection}
              className="items-center rounded-xl border border-border-2 py-2.5"
            >
              <Text className="text-sm font-sans-semibold text-gold">
                {activeTimes.outAt ? "Correggi orari" : "Inserisci uscita"}
              </Text>
            </Pressable>
            <Pressable
              disabled={pending}
              onPress={() => {
                setReason("");
                setMode("void");
              }}
              className="items-center py-1.5"
            >
              <Text className="text-xs font-sans-semibold text-error">
                Annulla timbratura
              </Text>
            </Pressable>
          </View>
        ) : null}

        {corrections.length > 0 ? (
          <View className="mt-2 border-t border-border pt-2">
            <Pressable
              onPress={() => setShowHistory((value) => !value)}
              className="flex-row items-center justify-between py-1"
            >
              <Text className="text-xs text-t3">
                {corrections.length === 1
                  ? "1 correzione registrata"
                  : `${corrections.length} correzioni registrate`}
              </Text>
              <Text className="text-xs font-sans-semibold text-gold">
                {showHistory ? "Nascondi" : "Mostra"}
              </Text>
            </Pressable>
            {showHistory ? (
              <View className="mt-2 gap-2">
                {corrections.map((item) => (
                  <View key={item.id} className="rounded-xl bg-bg-2 px-3 py-2">
                    <Text className="text-xs text-t2">{item.reason}</Text>
                    <Text className="mt-1 text-[11px] text-t4">
                      {item.corrector?.full_name ?? "Gestore"} ·{" "}
                      {formatCorrectionDate(item.created_at)}
                    </Text>
                  </View>
                ))}
                <Text className="text-[11px] text-t4">
                  Originale: {formatClockTime(activeClock.clock_in_at)} –{" "}
                  {activeClock.clock_out_at
                    ? formatClockTime(activeClock.clock_out_at)
                    : "uscita mancante"}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      <Modal
        visible={mode != null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeEditor}
      >
        <Pressable
          onPress={pending ? undefined : closeEditor}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.66)" }}
          className="items-center justify-center px-6"
        >
          <Pressable
            onPress={() => {}}
            className="max-h-[88%] w-full rounded-3xl border border-border-2 bg-bg-card p-6"
          >
            <Text className="text-lg font-sans-bold text-t1">
              {mode === "correct"
                ? activeTimes.outAt
                  ? "Correggi la timbratura"
                  : "Inserisci l'uscita"
                : "Annulla la timbratura"}
            </Text>
            <Text className="mt-2 text-sm leading-5 text-t2">
              {mode === "correct"
                ? "Gli orari originali restano nello storico. Indica il motivo della modifica."
                : "La timbratura non verrà conteggiata, ma resterà nello storico."}
            </Text>

            <ScrollView
              className="mt-5"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {mode === "correct" ? (
                <View className="flex-row gap-3">
                  <TimeField
                    className="flex-1"
                    label="Entrata"
                    value={inAt}
                    onChange={setInAt}
                  />
                  <TimeField
                    className="flex-1"
                    label="Uscita"
                    value={outAt}
                    onChange={setOutAt}
                  />
                </View>
              ) : null}

              {mode === "correct" && invalidRange ? (
                <Text className="mt-2 text-xs font-sans-semibold text-error">
                  L’uscita deve essere successiva all’entrata.
                </Text>
              ) : null}

              <View className="mt-5">
                <Input
                  label="Motivo"
                  value={reason}
                  onChangeText={setReason}
                  placeholder={
                    mode === "correct"
                      ? "Es. uscita dimenticata"
                      : "Es. timbratura inserita per errore"
                  }
                  multiline
                  numberOfLines={3}
                  className="h-24"
                  textAlignVertical="top"
                  maxLength={500}
                />
              </View>
            </ScrollView>

            <View className="mt-6 gap-2.5">
              {mode === "correct" ? (
                <GoldButton
                  label={pending ? "Salvataggio…" : "Salva correzione"}
                  disabled={!canSaveCorrection}
                  onPress={onCorrect}
                />
              ) : (
                <Pressable
                  disabled={pending || !reason.trim()}
                  onPress={onVoid}
                  className="items-center rounded-full border border-error/60 py-3.5 disabled:opacity-50"
                >
                  <Text className="text-sm font-sans-semibold text-error">
                    {pending ? "Annullamento…" : "Conferma annullamento"}
                  </Text>
                </Pressable>
              )}
              <Pressable
                disabled={pending}
                onPress={closeEditor}
                className="items-center py-2"
              >
                <Text className="text-sm text-t3">Indietro</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
