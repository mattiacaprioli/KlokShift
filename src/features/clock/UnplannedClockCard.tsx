import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/ui/Mono";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { Text, View } from "@/tw";
import type { MyUnplannedClock } from "./api";
import { usePunchUnplannedClock } from "./hooks";
import { formatClockTime } from "./hours";

/**
 * Timbratura senza turno, nella Home del professionista: una card per sede in
 * cui chi gestisce l'ha abilitata.
 *
 * Il turno non esiste ancora: nasce all'uscita, con gli orari timbrati, e va a
 * chi gestisce da approvare. La mansione si chiede solo a chi ne ha più d'una
 * (con una sola la sceglie il server).
 *
 * `canStart` è falso quando c'è già un turno pianificato da timbrare: si timbra
 * quello, e la RPC lo rifiuterebbe comunque (`clock_planned_shift`). Un'entrata
 * già aperta invece si mostra sempre, perché l'uscita va offerta.
 */
export function UnplannedClockCard({
  entry,
  canStart,
}: {
  entry: MyUnplannedClock;
  canStart: boolean;
}) {
  const toast = useToast();
  const punch = usePunchUnplannedClock();
  const [preparing, setPreparing] = useState(false);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState<"in" | "out" | null>(null);

  const open = entry.open;
  if (!open && !canStart) return null;

  const roleName = open?.roleId
    ? entry.roles.find((r) => r.id === open.roleId)?.name
    : undefined;

  function doPunch() {
    if (!confirming) return;
    const action = confirming;
    punch.mutate(
      {
        venueMemberId: entry.venueMemberId,
        action,
        roleId: action === "in" ? roleId : undefined,
        note: action === "in" ? note : undefined,
      },
      {
        onSuccess: () => {
          setConfirming(null);
          setPreparing(false);
          setNote("");
          setRoleId(null);
          toast.show(
            action === "in"
              ? "Entrata registrata"
              : "Uscita registrata · il turno è da approvare"
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
        <Mono gold>{open ? "Fuori turno · In servizio" : "Senza turno"}</Mono>
        <Text className="mt-1 text-lg font-sans-bold text-t1" numberOfLines={1}>
          {entry.venueName}
        </Text>

        {open ? (
          <>
            <Text className="mt-4 text-sm text-t2">
              Entrata registrata alle {formatClockTime(open.clockInAt)}
              {roleName ? ` · ${roleName}` : ""}.
            </Text>
            <GoldButton
              className="mt-4"
              label={punch.isPending ? "Registrazione…" : "Timbra uscita"}
              disabled={punch.isPending}
              onPress={() => setConfirming("out")}
            />
          </>
        ) : preparing ? (
          <View className="mt-4 gap-4">
            {entry.roles.length > 1 ? (
              <View className="gap-2">
                <Mono>Mansione</Mono>
                <View className="flex-row flex-wrap gap-1.5">
                  {entry.roles.map((role) => (
                    <Chip
                      key={role.id}
                      label={role.name}
                      gold
                      active={roleId === role.id}
                      onPress={() =>
                        setRoleId(roleId === role.id ? null : role.id)
                      }
                    />
                  ))}
                </View>
              </View>
            ) : null}
            <Input
              label="Cosa stai facendo (facoltativo)"
              placeholder="Es. inventario, evento, sostituzione"
              value={note}
              onChangeText={setNote}
              maxLength={500}
            />
            <View className="flex-row gap-3">
              <GhostButton
                className="flex-1"
                label="Annulla"
                disabled={punch.isPending}
                onPress={() => setPreparing(false)}
              />
              <GoldButton
                className="flex-1"
                label={punch.isPending ? "Registrazione…" : "Timbra entrata"}
                disabled={punch.isPending}
                onPress={() => setConfirming("in")}
              />
            </View>
          </View>
        ) : (
          <>
            <Text className="mt-4 text-sm leading-5 text-t3">
              Lavori senza un turno assegnato? Timbra entrata e uscita: il turno
              arriva a chi gestisce per l’approvazione.
            </Text>
            <GhostButton
              className="mt-4"
              label="Timbra senza turno"
              onPress={() => setPreparing(true)}
            />
          </>
        )}
      </Card>

      <ConfirmModal
        visible={confirming != null}
        title={
          confirming === "out" ? "Timbrare l’uscita?" : "Timbrare l’entrata?"
        }
        message={`Verrà registrato l’orario corrente del server per ${entry.venueName}.`}
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
