import { useState } from "react";
import { Modal } from "react-native";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import { TimeField } from "@/features/shifts/TimeField";
import type { AssignmentWithStaff } from "@/features/assignments/api";
import { isActiveAssignment } from "@/features/assignments/status";
import { userErrorMessage } from "@/lib/errors";
import {
  formatHours,
  formatHoursVariance,
  type ShiftBreak,
} from "@/lib/format";
import { useToast } from "@/providers/Toast";
import { useNow } from "@/lib/useNow";
import {
  useApproveClockRecord,
  useCorrectClockBreak,
  useCorrectClockRecord,
  useEnterClockRecord,
  useVoidClockRecord,
} from "./hooks";
import {
  clockBreakText,
  clockRecordHours,
  effectiveClockBreak,
  effectiveClockTimes,
  formatClockTime,
} from "./hours";
import { UNPLANNED_VOID_NOTICE } from "./unplanned";

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
  clocked,
  scheduledInAt,
  scheduledOutAt,
  plannedHours,
  shiftBreak,
  locked = false,
  unplanned = false,
}: {
  assignment: AssignmentWithStaff;
  /**
   * Le ore di questa riga passano dalla timbratura (`hoursAreClocked`). Senza
   * timbratura e senza timbratura dovuta non c'è niente da mostrare qui: le ore
   * si correggono col numero, sotto.
   */
  clocked: boolean;
  /** Inizio pianificato del turno, proposto quando si inseriscono gli orari. */
  scheduledInAt: Date;
  /** Fine pianificata del turno, proposta quando manca l'uscita. */
  scheduledOutAt: Date;
  /** Le ore del turno: lo scostamento si legge accanto a quelle timbrate. */
  plannedHours: number;
  /** Pausa pianificata e scelta della sede, copiate sul turno. */
  shiftBreak: ShiftBreak;
  locked?: boolean;
  /** Turno nato dalla timbratura: annullarla lo toglie. */
  unplanned?: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const approve = useApproveClockRecord();
  const correct = useCorrectClockRecord();
  const correctBreak = useCorrectClockBreak();
  const voidClock = useVoidClockRecord();
  const clock = assignment.clock;
  const times = clock ? effectiveClockTimes(clock) : null;
  const personName = assignment.staff_member?.display_name ?? "Il professionista";
  const [mode, setMode] = useState<EditMode>(null);
  const [inAt, setInAt] = useState(() => new Date());
  const [outAt, setOutAt] = useState(() => scheduledOutAt);
  const [reason, setReason] = useState("");
  const [breakDraft, setBreakDraft] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [entering, setEntering] = useState(false);
  const works = isActiveAssignment(assignment.status);

  if (!clock || !times) {
    if (!clocked) return null;
    // Doveva timbrare e non l'ha fatto: senza orari quelle ore non contano.
    // Li inserisce chi ha «Ore», con un motivo, e nascono già approvati.
    return (
      <>
        <View className="mt-3 rounded-2xl border border-border bg-bg-1 p-3.5">
          <Text className="text-sm font-sans-semibold text-t1">
            {personName} non ha timbrato
          </Text>
          <Text className="mt-0.5 text-xs leading-4 text-t3">
            Senza orari queste ore non contano.
          </Text>
          {!locked && works ? (
            <GoldButton
              className="mt-3"
              size="sm"
              label="Inserisci orari"
              onPress={() => setEntering(true)}
            />
          ) : null}
        </View>
        {entering ? (
          <EnterTimesModal
            assignmentId={assignment.id}
            personName={personName}
            defaultIn={scheduledInAt}
            defaultOut={scheduledOutAt}
            onClose={() => setEntering(false)}
          />
        ) : null}
      </>
    );
  }

  // Alias non-null stabili anche dentro i callback asincroni.
  const activeClock = clock;
  const activeTimes = times;
  const hours = clockRecordHours(activeClock, shiftBreak);
  const delta = hours != null ? formatHoursVariance(hours - plannedHours) : null;
  const pause = effectiveClockBreak(activeClock, shiftBreak.break_minutes);
  const pauseText = clockBreakText(pause, shiftBreak.break_paid);
  const reviewed = assignment.attendance_reviewed_at != null;
  const pending =
    approve.isPending ||
    correct.isPending ||
    correctBreak.isPending ||
    voidClock.isPending;
  const invalidRange = outAt.getTime() <= inAt.getTime();
  const breakValue = Number(breakDraft);
  const breakValid = breakDraft !== "" && Number.isInteger(breakValue);
  // Il motivo è facoltativo (20261026000300): la traccia è la correzione
  // stessa, con autore e ora. Per annullare invece resta obbligatorio.
  const canSaveCorrection = !invalidRange && breakValid && !pending;
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
    setBreakDraft(String(pause.minutes));
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

  async function onCorrect() {
    if (!canSaveCorrection) return;
    // Due RPC, ognuna solo se il suo dato è cambiato: una pausa corretta da
    // sola non deve riscrivere entrata e uscita.
    const timesChanged =
      !activeTimes.outAt ||
      inAt.getTime() !== new Date(activeTimes.inAt).getTime() ||
      outAt.getTime() !== new Date(activeTimes.outAt).getTime();
    const breakChanged = breakValue !== pause.minutes;
    try {
      if (timesChanged || !breakChanged) {
        await correct.mutateAsync({
          recordId: activeClock.id,
          inAt: inAt.toISOString(),
          outAt: outAt.toISOString(),
          reason: reason.trim(),
        });
      }
      if (breakChanged) {
        await correctBreak.mutateAsync({
          recordId: activeClock.id,
          minutes: breakValue,
          reason: reason.trim(),
        });
      }
      // Correggere vuol dire aver controllato: si approva nello stesso passo,
      // altrimenti la correzione lasciava le ore «da verificare» e fuori dal
      // consuntivo finché qualcuno non tornava ad approvarle.
      if (works) await approve.mutateAsync(assignment.id);
      setMode(null);
      setReason("");
      toast.show(
        works
          ? "Correzione salvata, ore approvate"
          : !activeTimes.outAt
            ? "Uscita inserita"
            : timesChanged
              ? "Orari corretti"
              : "Pausa corretta"
      );
    } catch (error) {
      toast.show(
        userErrorMessage(error, "Impossibile salvare la correzione."),
        "error"
      );
    }
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
          // Il turno «Fuori turno» non esiste più: si torna da dove si veniva.
          // Senza storia (link da notifica) resta il «Turno non trovato» del
          // dettaglio, che si rilegge da sé.
          if (unplanned && router.canGoBack()) router.back();
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
              {pauseText ? (
                <Text className="mt-0.5 text-xs text-t3">
                  {pauseText.charAt(0).toUpperCase() + pauseText.slice(1)}
                </Text>
              ) : null}
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
                {activeTimes.outAt ? "Correggi orari e pausa" : "Inserisci uscita"}
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
                    <Text className="text-xs text-t2">
                      {item.reason ?? "Nessun motivo indicato"}
                    </Text>
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
                ? "Gli orari originali restano nello storico, con chi li ha corretti."
                : unplanned
                  ? `${UNPLANNED_VOID_NOTICE} La timbratura resterà nello storico.`
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

              {mode === "correct" ? (
                <View className="mt-5">
                  <Input
                    label="Pausa (minuti)"
                    value={breakDraft}
                    onChangeText={(text) =>
                      setBreakDraft(text.replace(/\D/g, "").slice(0, 4))
                    }
                    keyboardType="number-pad"
                    placeholder="0"
                  />
                </View>
              ) : null}

              <View className="mt-5">
                <Input
                  label={mode === "correct" ? "Motivo (facoltativo)" : "Motivo"}
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
                  label={
                    pending
                      ? "Salvataggio…"
                      : works
                        ? "Salva e approva"
                        : "Salva correzione"
                  }
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

/**
 * Inserisci gli orari di chi doveva timbrare e non l'ha fatto
 * (`enter_clock_record`): entrata, uscita e motivo, già approvati. La pausa è
 * quella del turno; si corregge dopo, come ogni timbratura.
 */
function EnterTimesModal({
  assignmentId,
  personName,
  defaultIn,
  defaultOut,
  onClose,
}: {
  assignmentId: string;
  personName: string;
  defaultIn: Date;
  defaultOut: Date;
  onClose: () => void;
}) {
  const toast = useToast();
  const enter = useEnterClockRecord();
  const [inAt, setInAt] = useState(() => defaultIn);
  const [outAt, setOutAt] = useState(() => defaultOut);
  const [reason, setReason] = useState("");
  const now = useNow();
  const invalidRange = outAt.getTime() <= inAt.getTime();
  const future = outAt.getTime() > now.getTime();
  const canSave = !invalidRange && !future && !enter.isPending;

  function onSave() {
    if (!canSave) return;
    enter.mutate(
      {
        assignmentId,
        inAt: inAt.toISOString(),
        outAt: outAt.toISOString(),
        reason: reason.trim(),
      },
      {
        onSuccess: () => {
          toast.show("Orari inseriti, ore approvate");
          onClose();
        },
        onError: (error) =>
          toast.show(userErrorMessage(error, "Impossibile salvare gli orari."), "error"),
      }
    );
  }

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable
        onPress={enter.isPending ? undefined : onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.66)" }}
        className="items-center justify-center px-6"
      >
        <Pressable
          onPress={() => {}}
          className="max-h-[88%] w-full rounded-3xl border border-border-2 bg-bg-card p-6"
        >
          <Text className="text-lg font-sans-bold text-t1">Inserisci gli orari</Text>
          <Text className="mt-2 text-sm leading-5 text-t2">
            Gli orari in cui {personName} ha lavorato davvero. Restano nello
            storico con chi li ha inseriti, e le ore contano subito.
          </Text>

          <ScrollView
            className="mt-5"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View className="flex-row gap-3">
              <TimeField className="flex-1" label="Entrata" value={inAt} onChange={setInAt} />
              <TimeField className="flex-1" label="Uscita" value={outAt} onChange={setOutAt} />
            </View>
            {invalidRange ? (
              <Text className="mt-2 text-xs font-sans-semibold text-error">
                L’uscita deve essere successiva all’entrata.
              </Text>
            ) : future ? (
              <Text className="mt-2 text-xs font-sans-semibold text-error">
                L’uscita non può essere nel futuro.
              </Text>
            ) : null}
            <View className="mt-5">
              <Input
                label="Motivo (facoltativo)"
                value={reason}
                onChangeText={setReason}
                placeholder="Es. non ha timbrato, mezz’ora in più"
                multiline
                numberOfLines={3}
                className="h-24"
                textAlignVertical="top"
                maxLength={500}
              />
            </View>
          </ScrollView>

          <View className="mt-6 gap-2.5">
            <GoldButton
              label={enter.isPending ? "Salvataggio…" : "Salva e approva"}
              disabled={!canSave}
              onPress={onSave}
            />
            <Pressable disabled={enter.isPending} onPress={onClose} className="items-center py-2">
              <Text className="text-sm text-t3">Indietro</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
