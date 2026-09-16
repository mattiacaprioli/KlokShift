import { useState } from "react";
import { Modal } from "react-native";
import { Pressable, Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import type { Absence } from "./api";
import { useSetAbsenceInpsProtocol, useWithdrawAbsence } from "./hooks";
import {
  ABSENCE_KIND_LABEL,
  ABSENCE_STATUS_LABEL,
  absenceDays,
  absenceStatusTone,
  canWithdrawAbsence,
  formatAbsenceRange,
} from "./labels";
import { AbsenceConflictsBlock } from "./AbsenceConflicts";
import { ResolveAbsenceModal } from "./ResolveAbsenceModal";

type Props = {
  absences: Absence[];
  /**
   * `mine`: il professionista (ritira, aggiunge il protocollo).
   * `manager`: chi gestisce l'organico (decide, aggiunge il protocollo).
   */
  mode: "mine" | "manager";
  /** Riga secondaria per assenza, es. l'azienda per chi lavora in più posti. */
  subtitleFor?: (absence: Absence) => string | null;
};

/**
 * Elenco di assenze, condiviso fra «Le mie assenze» e la scheda persona.
 *
 * Le rifiutate e le ritirate restano in lista (in grigio): un «no» sulle ferie è
 * una cosa che si vuole poter ritrovare, non un errore da far sparire.
 */
export function AbsenceList({ absences, mode, subtitleFor }: Props) {
  const toast = useToast();
  const withdraw = useWithdrawAbsence();
  const [resolving, setResolving] = useState<Absence | null>(null);
  const [protocolFor, setProtocolFor] = useState<Absence | null>(null);

  function onWithdraw(a: Absence) {
    withdraw.mutate(a.id, {
      onSuccess: () =>
        toast.show(a.status === "pending" ? "Richiesta ritirata" : "Assenza annullata"),
      onError: (e) =>
        toast.show(userErrorMessage(e, "Operazione non riuscita."), "error"),
    });
  }

  return (
    <>
      <View className="gap-2.5">
        {absences.map((a) => {
          const closed = a.status === "rejected" || a.status === "withdrawn";
          const sick = a.kind === "malattia";
          const days = absenceDays(a);
          const subtitle = subtitleFor?.(a);
          const actions = [
            mode === "manager" && a.status === "pending" ? (
              <RowAction
                key="resolve"
                label="Rispondi"
                gold
                onPress={() => setResolving(a)}
              />
            ) : null,
            sick && a.status === "approved" ? (
              <RowAction
                key="protocol"
                label={a.inps_protocol ? "Modifica protocollo" : "Aggiungi protocollo"}
                onPress={() => setProtocolFor(a)}
              />
            ) : null,
            mode === "mine" && canWithdrawAbsence(a) ? (
              <RowAction
                key="withdraw"
                label={a.status === "pending" ? "Ritira" : "Annulla"}
                disabled={withdraw.isPending}
                onPress={() => onWithdraw(a)}
              />
            ) : null,
          ].filter(Boolean);
          return (
            <View
              key={a.id}
              className="rounded-2xl border border-border-2 bg-bg-card px-4 py-3.5"
              style={closed ? { opacity: 0.6 } : undefined}
            >
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 font-sans-semibold text-[15px] text-t1">
                  {ABSENCE_KIND_LABEL[a.kind]}
                  {a.start_time ? "" : ` · ${days} ${days === 1 ? "giorno" : "giorni"}`}
                </Text>
                <Pill
                  label={ABSENCE_STATUS_LABEL[a.status]}
                  variant={absenceStatusTone(a.status)}
                />
              </View>
              <Text className="mt-1 text-[13px] text-t2">
                {formatAbsenceRange(a)}
              </Text>
              {subtitle ? (
                <Text className="mt-0.5 text-xs text-t3">{subtitle}</Text>
              ) : null}
              {a.note ? (
                <Text className="mt-2 text-[13px] leading-5 text-t2">{a.note}</Text>
              ) : null}
              {sick && a.status === "approved" ? (
                <Text className="mt-2 text-xs text-t3">
                  {a.inps_protocol
                    ? `Protocollo INPS ${a.inps_protocol}`
                    : "Protocollo INPS non ancora indicato"}
                </Text>
              ) : null}
              {a.resolution_note ? (
                <Text className="mt-2 text-xs leading-4 text-t3">
                  Nota: {a.resolution_note}
                </Text>
              ) : null}

              {mode === "manager" && a.status === "approved" ? (
                <AbsenceConflictsBlock absence={a} />
              ) : null}

              {actions.length > 0 ? (
                <View className="mt-3 flex-row flex-wrap gap-2">{actions}</View>
              ) : null}
            </View>
          );
        })}
      </View>

      {resolving ? (
        <ResolveAbsenceModal
          absence={resolving}
          onClose={() => setResolving(null)}
        />
      ) : null}
      {protocolFor ? (
        <ProtocolModal
          absence={protocolFor}
          onClose={() => setProtocolFor(null)}
        />
      ) : null}
    </>
  );
}

function RowAction({
  label,
  gold,
  disabled,
  onPress,
}: {
  label: string;
  gold?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={
        gold
          ? "rounded-full bg-gold px-4 py-2"
          : "rounded-full border border-border-2 px-4 py-2"
      }
    >
      <Text
        className={gold ? "text-[13px] font-sans-bold" : "text-[13px] font-sans-semibold text-t2"}
        style={gold ? { color: "#1A1206" } : undefined}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Il protocollo del certificato arriva spesso dopo la visita: si aggiunge qui. */
function ProtocolModal({
  absence,
  onClose,
}: {
  absence: Absence;
  onClose: () => void;
}) {
  const toast = useToast();
  const save = useSetAbsenceInpsProtocol();
  const [protocol, setProtocol] = useState(absence.inps_protocol ?? "");

  function onSave() {
    save.mutate(
      { absenceId: absence.id, protocol },
      {
        onSuccess: () => {
          onClose();
          toast.show("Protocollo salvato");
        },
        onError: (e) =>
          toast.show(userErrorMessage(e, "Salvataggio non riuscito."), "error"),
      }
    );
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        onPress={save.isPending ? undefined : onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }}
        className="items-center justify-center px-6"
      >
        <Pressable
          onPress={() => {}}
          className="w-full rounded-3xl border border-border-2 bg-bg-card p-6"
        >
          <Text className="text-lg font-sans-bold text-t1">
            Protocollo INPS
          </Text>
          <Text className="mt-1 text-sm text-t2">
            Malattia · {formatAbsenceRange(absence)}
          </Text>
          <View className="mt-4">
            <Input
              value={protocol}
              onChangeText={setProtocol}
              placeholder="Numero di protocollo del certificato"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={40}
              autoFocus
            />
          </View>
          <View className="mt-5 gap-2.5">
            <GoldButton
              label={save.isPending ? "Salvataggio…" : "Salva"}
              disabled={save.isPending}
              onPress={onSave}
            />
            <Pressable
              onPress={onClose}
              disabled={save.isPending}
              className="items-center py-2"
            >
              <Text className="text-sm text-t4">Annulla</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
