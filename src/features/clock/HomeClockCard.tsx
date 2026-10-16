import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { Mono } from "@/components/ui/Mono";
import type { AgendaItem } from "@/features/assignments/agenda";
import { formatShiftRange } from "@/lib/format";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { Text, View } from "@/tw";
import { homeClockState } from "./availability";
import { ClockBreakButton } from "./ClockBreakButton";
import { usePunchClock } from "./hooks";
import { effectiveClockTimes, formatClockTime, openClockBreak } from "./hours";

/**
 * `inBlocked` lo decide la Home (`blocksPlannedClockIn`): con un'entrata senza
 * turno ancora aperta l'entrata del turno non si offre, perché le ore si
 * conterebbero due volte (la RPC la rifiuta con `clock_already_open`).
 * L'uscita di un turno già timbrato resta sempre disponibile.
 */
export function HomeClockCard({
  item,
  inBlocked = false,
}: {
  item: AgendaItem;
  inBlocked?: boolean;
}) {
  const toast = useToast();
  const punch = usePunchClock();
  const [confirming, setConfirming] = useState<"in" | "out" | null>(null);
  const state = homeClockState(item);
  const blocked = state === "in" && inBlocked;
  const times = item.clock ? effectiveClockTimes(item.clock) : null;
  const pause = item.clock ? openClockBreak(item.clock) : null;
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
              {state === "in" ? "Da timbrare" : pause ? "In pausa" : "In servizio"}
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
            {pause ? ` In pausa dalle ${formatClockTime(pause.started_at)}.` : ""}
          </Text>
        ) : blocked ? (
          <Text className="mt-4 text-sm leading-5 text-t2">
            Prima registra l’uscita dal fuori turno.
          </Text>
        ) : (
          <Text className="mt-4 text-sm leading-5 text-t3">
            Verrà registrato l’orario corrente del server.
          </Text>
        )}

        {/* In pausa l'azione principale è riprendere; l'uscita resta, sotto. */}
        {state === "out" && item.clock && pause ? (
          <>
            <ClockBreakButton className="mt-4" recordId={item.clock.id} onBreak />
            <GhostButton
              className="mt-3"
              label={punch.isPending ? "Registrazione…" : "Timbra uscita"}
              disabled={punch.isPending}
              onPress={() => setConfirming("out")}
            />
          </>
        ) : (
          <>
            <GoldButton
              className="mt-4"
              label={
                punch.isPending
                  ? "Registrazione…"
                  : state === "in"
                    ? "Timbra entrata"
                    : "Timbra uscita"
              }
              disabled={punch.isPending || blocked}
              onPress={() => setConfirming(state)}
            />
            {state === "out" && item.clock ? (
              <ClockBreakButton
                className="mt-3"
                recordId={item.clock.id}
                onBreak={false}
              />
            ) : null}
          </>
        )}
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
