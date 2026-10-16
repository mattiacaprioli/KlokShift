import { useState } from "react";
import { Modal } from "react-native";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { TimeField } from "@/features/shifts/TimeField";
import { userErrorMessage } from "@/lib/errors";
import { useNow } from "@/lib/useNow";
import { useToast } from "@/providers/Toast";
import { Pressable, ScrollView, Text, View } from "@/tw";
import type { OpenUnplannedClock } from "./api";
import { useCloseUnplannedClock, useVoidUnplannedClock } from "./hooks";
import { formatClockTime } from "./hours";
import {
  defaultUnplannedOut,
  formatRomeDay,
  formatUnplannedDuration,
  romeTime,
  timeFromPicker,
  timeToPicker,
  unplannedOutAt,
  validateUnplannedOut,
} from "./unplanned";

type Mode = "close" | "void";

/**
 * Una timbratura senza turno ancora aperta, per chi ha «Ore»: si registra
 * l'uscita (dimenticata, o oltre le 16 ore che il professionista non può più
 * chiudere da sé) oppure si annulla un'entrata fatta per errore. In tutti e due
 * i casi serve un motivo, e il record originale resta nello storico.
 */
export function UnplannedClockModal({
  clock,
  onClose,
}: {
  clock: OpenUnplannedClock | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const close = useCloseUnplannedClock();
  const voidClock = useVoidUnplannedClock();
  const [mode, setMode] = useState<Mode>("close");
  // L'uscita come orario di Roma (`HH:mm`): il giorno lo dà l'entrata.
  const [outTime, setOutTime] = useState("");
  const [outChoice, setOutChoice] = useState<0 | 1 | undefined>();
  const [reason, setReason] = useState("");
  const [lastId, setLastId] = useState<string | null>(null);
  const pending = close.isPending || voidClock.isPending;
  const now = useNow(15_000);

  // Il form riparte a ogni timbratura aperta: niente motivo della precedente.
  if (clock && clock.recordId !== lastId) {
    setLastId(clock.recordId);
    setMode("close");
    setOutTime(romeTime(defaultUnplannedOut(clock.clockInAt, now.getTime())));
    setOutChoice(undefined);
    setReason("");
  }

  // Stesse regole del web (`UnplannedClockDialog`): orario di Roma, ora
  // ripetuta da scegliere, uscita dopo l'entrata, non nel futuro, entro 24 ore.
  const bare = clock ? unplannedOutAt(clock.clockInAt, outTime) : null;
  const ambiguous = bare != null && !bare.ok && bare.reason === "ambiguous";
  const outResult =
    clock && ambiguous && outChoice !== undefined
      ? unplannedOutAt(clock.clockInAt, outTime, outChoice)
      : bare;
  const outError =
    !clock || !outResult
      ? null
      : outResult.ok
        ? validateUnplannedOut(clock.clockInAt, outResult.iso, now.getTime())
        : outResult.message;
  const outAt = outResult?.ok && !outError ? outResult.iso : null;
  const canSave =
    reason.trim().length > 0 && !pending && (mode === "void" || outAt != null);

  function dismiss() {
    if (!pending) onClose();
  }

  function onConfirm() {
    if (!clock || !canSave) return;
    const handlers = {
      onSuccess: () => {
        toast.show(
          mode === "close"
            ? "Uscita registrata · il turno è da approvare"
            : "Timbratura annullata"
        );
        onClose();
      },
      onError: (error: unknown) =>
        toast.show(userErrorMessage(error, "Operazione non riuscita. Riprova."), "error"),
    };
    if (mode === "close" && outAt) {
      close.mutate(
        { recordId: clock.recordId, outAt, reason: reason.trim() },
        handlers
      );
    } else {
      voidClock.mutate({ recordId: clock.recordId, reason: reason.trim() }, handlers);
    }
  }

  return (
    <Modal
      visible={clock != null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismiss}
    >
      <Pressable
        onPress={pending ? undefined : dismiss}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.66)" }}
        className="items-center justify-center px-6"
      >
        <Pressable
          onPress={() => {}}
          className="max-h-[88%] w-full rounded-3xl border border-border-2 bg-bg-card p-6"
        >
          <Text className="text-lg font-sans-bold text-t1">
            {clock?.memberName ?? "Timbratura"} · fuori turno
          </Text>
          <Text className="mt-2 text-sm leading-5 text-t2">
            {clock
              ? `In servizio da ${formatRomeDay(clock.clockInAt)} alle ${formatClockTime(
                  clock.clockInAt
                )} a ${clock.venueName}${
                  clock.roleName ? ` · ${clock.roleName}` : ""
                }.`
              : ""}
            {clock?.note ? ` «${clock.note}»` : ""}
          </Text>

          <View className="mt-4 flex-row gap-2">
            {(["close", "void"] as const).map((m) => (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                className={
                  mode === m
                    ? "flex-1 items-center rounded-full border border-gold bg-gold/10 py-2"
                    : "flex-1 items-center rounded-full border border-border py-2"
                }
              >
                <Text
                  className={
                    mode === m
                      ? "text-sm font-sans-semibold text-gold"
                      : "text-sm text-t2"
                  }
                >
                  {m === "close" ? "Registra uscita" : "Annulla entrata"}
                </Text>
              </Pressable>
            ))}
          </View>

          <ScrollView
            className="mt-5"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {mode === "close" ? (
              <>
                <TimeField
                  label="Uscita"
                  value={timeToPicker(outTime || "00:00")}
                  onChange={(picked) => {
                    setOutTime(timeFromPicker(picked));
                    setOutChoice(undefined);
                  }}
                />
                {ambiguous ? (
                  <View className="mt-3 flex-row gap-2">
                    {([0, 1] as const).map((c) => (
                      <Pressable
                        key={c}
                        onPress={() => setOutChoice(c)}
                        className={
                          outChoice === c
                            ? "flex-1 items-center rounded-full border border-gold bg-gold/10 py-2"
                            : "flex-1 items-center rounded-full border border-border py-2"
                        }
                      >
                        <Text
                          className={
                            outChoice === c
                              ? "text-xs font-sans-semibold text-gold"
                              : "text-xs text-t2"
                          }
                        >
                          {c === 0 ? "La prima volta" : "La seconda volta"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {clock && outAt ? (
                  <Text className="mt-3 text-sm font-sans-semibold text-t1">
                    Uscita: {formatRomeDay(outAt)} {formatClockTime(outAt)} ·{" "}
                    {formatUnplannedDuration(clock.clockInAt, outAt)}
                  </Text>
                ) : null}
                <Text
                  className={
                    outError
                      ? "mt-2 text-xs leading-4 text-warning"
                      : "mt-2 text-xs leading-4 text-t3"
                  }
                >
                  {outError ??
                    "All’uscita nasce il turno «Fuori turno» con questi orari, da approvare."}
                </Text>
              </>
            ) : (
              <Text className="text-xs leading-4 text-t3">
                L’entrata non verrà conteggiata, ma resterà nello storico.
              </Text>
            )}

            <View className="mt-5">
              <Input
                label="Motivo"
                value={reason}
                onChangeText={setReason}
                placeholder={
                  mode === "close"
                    ? "Es. uscita dimenticata, confermata a voce"
                    : "Es. timbrata per errore"
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
            {mode === "close" ? (
              <GoldButton
                label={pending ? "Salvataggio…" : "Registra uscita"}
                disabled={!canSave}
                onPress={onConfirm}
              />
            ) : (
              <Pressable
                disabled={!canSave}
                onPress={onConfirm}
                className="items-center rounded-full border border-error/60 py-3.5 disabled:opacity-50"
              >
                <Text className="text-sm font-sans-semibold text-error">
                  {pending ? "Annullamento…" : "Conferma annullamento"}
                </Text>
              </Pressable>
            )}
            <Pressable disabled={pending} onPress={dismiss} className="items-center py-2">
              <Text className="text-sm text-t3">Indietro</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
