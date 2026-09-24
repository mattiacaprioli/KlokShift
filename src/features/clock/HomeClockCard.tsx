import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { GoldButton } from "@/components/ui/GoldButton";
import { Mono } from "@/components/ui/Mono";
import type { AgendaItem } from "@/features/assignments/agenda";
import { formatShiftRange } from "@/lib/format";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { Text, View } from "@/tw";
import { homeClockState } from "./availability";
import { usePunchClock } from "./hooks";
import { effectiveClockTimes, formatClockTime } from "./hours";

export function HomeClockCard({ item }: { item: AgendaItem }) {
  const toast = useToast();
  const punch = usePunchClock();
  const [confirming, setConfirming] = useState<"in" | "out" | null>(null);
  const state = homeClockState(item);
  const times = item.clock ? effectiveClockTimes(item.clock) : null;
  const venueName = item.shift.venue?.name ?? "Sede";

  if (!state) return null;

  function doPunch() {
    if (!confirming) return;
    const action = confirming;
    punch.mutate(
      { assignmentId: item.id, action },
      {
        onSuccess: () => {
          setConfirming(null);
          toast.show(
            action === "in" ? "Entrata registrata" : "Uscita registrata"
          );
        },
        onError: (error) => {
          setConfirming(null);
          toast.show(
            userErrorMessage(error, "Impossibile timbrare. Riprova."),
            "error"
          );
        },
      }
    );
  }

  return (
    <>
      <Card className="rounded-3xl border-border-gold bg-bg-card p-5">
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Mono gold>
              {state === "in" ? "Da timbrare" : "In servizio"}
            </Mono>
            <Text className="mt-1 text-lg font-sans-bold text-t1" numberOfLines={1}>
              {venueName}
            </Text>
            <Text className="mt-0.5 text-sm text-t3" numberOfLines={1}>
              {item.shift.title} · {formatShiftRange(
                item.shift.start_time,
                item.shift.end_time
              )}
            </Text>
          </View>
        </View>

        {times ? (
          <Text className="mt-4 text-sm text-t2">
            Entrata registrata alle {formatClockTime(times.inAt)}.
          </Text>
        ) : (
          <Text className="mt-4 text-sm leading-5 text-t3">
            Verrà registrato l’orario corrente del server.
          </Text>
        )}

        <GoldButton
          className="mt-4"
          label={
            punch.isPending
              ? "Registrazione…"
              : state === "in"
                ? "Timbra entrata"
                : "Timbra uscita"
          }
          disabled={punch.isPending}
          onPress={() => setConfirming(state)}
        />
      </Card>

      <ConfirmModal
        visible={confirming != null}
        title={
          confirming === "out" ? "Timbrare l’uscita?" : "Timbrare l’entrata?"
        }
        message={`Verrà registrato l’orario corrente del server per ${venueName}.`}
        confirmLabel={
          confirming === "out" ? "Timbra uscita" : "Timbra entrata"
        }
        pending={punch.isPending}
        onConfirm={doPunch}
        onCancel={() => setConfirming(null)}
      />
    </>
  );
}
