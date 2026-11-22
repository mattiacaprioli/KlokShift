import { useState } from "react";
import { Modal } from "react-native";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/ui/Mono";
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
  clockOutDayNote,
  clockRangeError,
  withDay,
  clockRecordHours,
  effectiveClockBreak,
  effectiveClockTimes,
  formatClockTime,
} from "./hours";
import { UNPLANNED_VOID_NOTICE } from "./unplanned";
import { AUTO_APPROVED_LABEL } from "./autoApprove";
import { useColors } from "@/lib/theme";
import { withAlpha } from "@/constants/colors";

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
  onMarkAbsent,
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
  /** Senza timbratura: l'altra risposta a «è venuto?». */
  onMarkAbsent?: () => void;
}) {
  const colors = useColors();
  const toast = useToast();
  const router = useRouter();
  const approve = useApproveClockRecord();
  const correct = useCorrectClockRecord();
  const correctBreak = useCorrectClockBreak();
  const voidClock = useVoidClockRecord();
  const clock = assignment.clock;
  const times = clock ? effectiveClockTimes(clock) : null;
  const personName = assignment.staff_member?.display_name ?? "Il dipendente";
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
          {!locked && works && onMarkAbsent ? (
            <Pressable
              onPress={onMarkAbsent}
              className="mt-2 items-center rounded-xl border border-border-2 py-2.5"
            >
              <Text className="text-sm font-sans-semibold text-t2">Segna assente</Text>
            </Pressable>
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
  const outDay = activeTimes.outAt
    ? clockOutDayNote(activeTimes.inAt, activeTimes.outAt)
    : null;
  const reviewed = assignment.attendance_reviewed_at != null;
  const pending =
    approve.isPending ||
    correct.isPending ||
    correctBreak.isPending ||
    voidClock.isPending;
  // Giorno e ora si scelgono entrambi: con la sola ora il giorno restava
  // quello timbrato, e un'uscita del giorno dopo dava 32 ore.
  const rangeError = clockRangeError(inAt, outAt);
  const invalidRange = rangeError != null;
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
      {/* Una sezione della card della persona, non una card dentro la card:
          tre colonne (entrata, uscita, pausa), poi le ore grandi con lo stato,
          poi le azioni. Prima era un riquadro di cinque righe piccole. */}
      <View className="mt-4 border-t border-border pt-4">
        <View className="flex-row gap-3">
          <ClockCell label="Entrata" value={formatClockTime(activeTimes.inAt)} />
          <ClockCell
            label="Uscita"
            value={activeTimes.outAt ? formatClockTime(activeTimes.outAt) : "Manca"}
            note={outDay ? `il ${outDay}` : null}
            warn={!activeTimes.outAt || outDay != null}
          />
          <ClockCell
            label="Pausa"
            value={pause.minutes > 0 ? formatHours(pause.minutes / 60) : "Nessuna"}
            note={pause.minutes > 0 ? (shiftBreak.break_paid ? "retribuita" : "non retribuita") : null}
          />
        </View>

        <View className="mt-4 flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <Text className="text-sm text-t3">Ore</Text>
            <View className="flex-row flex-wrap items-baseline gap-x-2">
              <Text className="text-2xl font-sans-bold text-t1">
                {hours != null ? formatHours(hours) : "—"}
              </Text>
              {delta ? (
                <Text className="text-sm font-sans-semibold text-warning">
                  {delta} sul turno
                </Text>
              ) : null}
            </View>
          </View>
          <Pill
            label={
              reviewed
                ? assignment.attendance_auto_approved
                  ? AUTO_APPROVED_LABEL
                  : "Approvate"
                : "Da verificare"
            }
            variant={reviewed ? "accepted" : "pending"}
          />
        </View>

        {!activeTimes.outAt ? (
          <View className="mt-3 rounded-xl bg-warning/10 px-3 py-2.5">
            <Text className="text-sm leading-5 text-warning">
              {personName} ha timbrato l’entrata, ma non l’uscita. Inseriscila
              prima di approvare le ore.
            </Text>
          </View>
        ) : outDay ? (
          <View className="mt-3 rounded-xl bg-warning/10 px-3 py-2.5">
            <Text className="text-sm leading-5 text-warning">
              L’uscita è di un altro giorno: controlla che sia giusta.
            </Text>
          </View>
        ) : null}

        {!locked ? (
          <View className="mt-4 flex-row gap-2.5">
            {!reviewed && activeTimes.outAt ? (
              <GoldButton
                className="flex-1"
                label={pending ? "Attendere…" : "Approva"}
                size="sm"
                disabled={pending}
                onPress={onApprove}
              />
            ) : null}
            <Pressable
              disabled={pending}
              onPress={openCorrection}
              accessibilityRole="button"
              className="flex-1 items-center justify-center rounded-full border border-border-2 py-2.5"
            >
              <Text className="text-sm font-sans-semibold text-gold">
                {activeTimes.outAt ? "Correggi" : "Inserisci uscita"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {!locked || corrections.length > 0 ? (
          <View className="mt-3 flex-row items-center justify-between">
            {!locked ? (
              <Pressable
                disabled={pending}
                onPress={() => {
                  setReason("");
                  setMode("void");
                }}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text className="text-sm text-error">Annulla timbratura</Text>
              </Pressable>
            ) : (
              <View />
            )}
            {corrections.length > 0 ? (
              <Pressable
                onPress={() => setShowHistory((value) => !value)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityState={{ expanded: showHistory }}
              >
                <Text className="text-sm text-t3">
                  {corrections.length === 1
                    ? "1 correzione"
                    : `${corrections.length} correzioni`}
                  <Text className="font-sans-semibold text-gold">
                    {showHistory ? "  Nascondi" : "  Mostra"}
                  </Text>
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {showHistory && corrections.length > 0 ? (
          <View className="mt-3 gap-2">
            {corrections.map((item) => (
              <View key={item.id} className="rounded-xl bg-bg-2 px-3 py-2.5">
                <Text className="text-sm text-t2">
                  {item.reason ?? "Nessun motivo indicato"}
                </Text>
                <Text className="mt-1 text-xs text-t4">
                  {item.corrector?.full_name ?? "La sede"} ·{" "}
                  {formatCorrectionDate(item.created_at)}
                </Text>
              </View>
            ))}
            <Text className="text-xs text-t4">
              Originale: {formatClockTime(activeClock.clock_in_at)} –{" "}
              {activeClock.clock_out_at
                ? formatClockTime(activeClock.clock_out_at)
                : "uscita mancante"}
            </Text>
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
          style={{ flex: 1, backgroundColor: withAlpha(colors.scrim, 0.66) }}
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
                <DayTimeFields
                  inAt={inAt}
                  outAt={outAt}
                  onIn={setInAt}
                  onOut={setOutAt}
                  error={rangeError}
                />
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
  const colors = useColors();
  const toast = useToast();
  const enter = useEnterClockRecord();
  const [inAt, setInAt] = useState(() => defaultIn);
  const [outAt, setOutAt] = useState(() => defaultOut);
  const [reason, setReason] = useState("");
  const now = useNow();
  const rangeError = clockRangeError(inAt, outAt);
  const invalidRange = rangeError != null;
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
        style={{ flex: 1, backgroundColor: withAlpha(colors.scrim, 0.66) }}
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
            <DayTimeFields
              inAt={inAt}
              outAt={outAt}
              onIn={setInAt}
              onOut={setOutAt}
              error={rangeError ?? (future ? "L’uscita non può essere nel futuro." : null)}
            />
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

/** Una colonna della timbratura: etichetta piccola, orario grande. */
function ClockCell({
  label,
  value,
  note,
  warn = false,
}: {
  label: string;
  value: string;
  note?: string | null;
  warn?: boolean;
}) {
  return (
    <View className="flex-1">
      <Text className="text-xs text-t3">{label}</Text>
      <Text
        className={warn ? "text-lg font-sans-semibold text-warning" : "text-lg font-sans-semibold text-t1"}
      >
        {value}
      </Text>
      {note ? (
        <Text className={warn ? "text-xs text-warning" : "text-xs text-t3"}>{note}</Text>
      ) : null}
    </View>
  );
}

/**
 * Entrata e uscita con **giorno e ora**, nelle due finestre (correzione e
 * inserimento). Il giorno si sceglie a parte e tiene l'ora (`withDay`).
 */
function DayTimeFields({
  inAt,
  outAt,
  onIn,
  onOut,
  error,
}: {
  inAt: Date;
  outAt: Date;
  onIn: (d: Date) => void;
  onOut: (d: Date) => void;
  error: string | null;
}) {
  return (
    <View className="gap-4">
      <View>
        <Mono className="mb-2">Entrata</Mono>
        <View className="flex-row gap-3">
          <TimeField
            className="flex-[1.4]"
            mode="date"
            value={inAt}
            onChange={(d) => onIn(withDay(inAt, d))}
          />
          <TimeField className="flex-1" value={inAt} onChange={onIn} />
        </View>
      </View>
      <View>
        <Mono className="mb-2">Uscita</Mono>
        <View className="flex-row gap-3">
          <TimeField
            className="flex-[1.4]"
            mode="date"
            value={outAt}
            onChange={(d) => onOut(withDay(outAt, d))}
          />
          <TimeField className="flex-1" value={outAt} onChange={onOut} />
        </View>
      </View>
      {error ? (
        <Text className="text-sm font-sans-semibold text-error">{error}</Text>
      ) : null}
    </View>
  );
}
