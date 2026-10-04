import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal } from "react-native";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import { cn } from "@/lib/cn";
import { userErrorMessage } from "@/lib/errors";
import { formatDate, todayString } from "@/lib/format";
import { useToast } from "@/providers/Toast";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import type { Absence } from "./api";
import {
  absenceDates,
  canCreditAbsence,
  creditChanges,
  creditDraftOf,
  creditSummary,
  fillEmptyCredits,
  parseCreditHours,
} from "./credits";
import { useAbsenceHourCredits, useSetAbsenceHourCredits, useSetAbsenceInpsProtocol, useWithdrawAbsence } from "./hooks";
import {
  ABSENCE_KIND_LABEL,
  ABSENCE_STATUS_LABEL,
  absenceDays,
  absenceStatusTone,
  canWithdrawAbsence,
  formatAbsenceRange,
  visibleAbsenceNote,
} from "./labels";
import { AbsenceConflictsBlock } from "./AbsenceConflicts";
import { ResolveAbsenceModal } from "./ResolveAbsenceModal";

type Props = {
  absences: Absence[];
  /**
   * `mine`: il professionista (ritira, aggiunge il riferimento del certificato).
   * `manager`: chi gestisce l'organico (decide, aggiunge il riferimento).
   */
  mode: "mine" | "manager";
  /** Riga secondaria per assenza, es. l'azienda per chi lavora in più posti. */
  subtitleFor?: (absence: Absence) => string | null;
  /** Il nome in testa alla riga, nelle liste con più persone (pagina Assenze). */
  titleFor?: (absence: Absence) => string | null;
};

/**
 * Elenco di assenze, condiviso fra «Le mie assenze» e la scheda persona.
 *
 * Le rifiutate e le ritirate restano in lista (in grigio): un «no» sulle ferie è
 * una cosa che si vuole poter ritrovare, non un errore da far sparire.
 */
export function AbsenceList({ absences, mode, subtitleFor, titleFor }: Props) {
  const toast = useToast();
  const { canAny, isOwner, myMemberId } = useOwnerVenues();
  const withdraw = useWithdrawAbsence();
  const [resolving, setResolving] = useState<Absence | null>(null);
  const [protocolFor, setProtocolFor] = useState<Absence | null>(null);
  const [creditFor, setCreditFor] = useState<Absence | null>(null);
  const today = todayString();

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
          const title = titleFor?.(a);
          const note = visibleAbsenceNote(a);
          const creditable =
            mode === "manager" &&
            canCreditAbsence(a, { canHours: canAny("can_view_hours"), isOwner, myMemberId });
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
                label={a.inps_protocol ? "Modifica riferimento" : "Aggiungi riferimento"}
                onPress={() => setProtocolFor(a)}
              />
            ) : null,
            creditable ? (
              <RowAction key="credit" label="Ore riconosciute" onPress={() => setCreditFor(a)} />
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
              {title ? (
                <Text className="mb-1 text-base font-sans-bold text-t1">
                  {title}
                </Text>
              ) : null}
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
              {note ? (
                <Text className="mt-2 text-[13px] leading-5 text-t2">{note}</Text>
              ) : null}
              {sick && a.status === "approved" ? (
                <Text className="mt-2 text-xs text-t3">
                  {a.inps_protocol
                    ? `Certificato medico · ${a.inps_protocol}`
                    : "Riferimento del certificato non ancora indicato"}
                </Text>
              ) : null}
              {creditable ? <CreditSummaryLine absence={a} /> : null}
              {a.resolution_note ? (
                <Text className="mt-2 text-xs leading-4 text-t3">
                  Nota: {a.resolution_note}
                </Text>
              ) : null}

              {/* Solo su quelle non finite: su una passata non c'è più niente da
                  togliere, e ogni blocco è una query sui turni della persona. */}
              {mode === "manager" &&
              a.status === "approved" &&
              a.end_date >= today ? (
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
          personName={titleFor?.(resolving)}
          onClose={() => setResolving(null)}
        />
      ) : null}
      {protocolFor ? (
        <ProtocolModal
          absence={protocolFor}
          onClose={() => setProtocolFor(null)}
        />
      ) : null}
      {creditFor ? <CreditModal absence={creditFor} onClose={() => setCreditFor(null)} /> : null}
    </>
  );
}

/**
 * Le ore riconosciute, un campo per giorno; nessuna conversione implicita.
 * ⚠️ Gemello web: `web/src/absences/AbsenceHourCredits.tsx`.
 */
function CreditModal({ absence, onClose }: { absence: Absence; onClose: () => void }) {
  const toast = useToast();
  const query = useAbsenceHourCredits(absence.id);
  const save = useSetAbsenceHourCredits();
  const saved = query.data;
  const dates = absenceDates(absence);
  // Il modulo nasce quando le ore salvate sono arrivate: prima sarebbe vuoto, e
  // salvarlo cancellerebbe quel che c'è.
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const form = draft ?? (saved ? creditDraftOf(dates, saved) : null);
  const [same, setSame] = useState("");
  const changes = form && saved ? creditChanges(form, saved) : null;
  const conflictOn = new Set((saved ?? []).filter((c) => c.conflict).map((c) => c.date));

  function onSave() {
    if (!changes || changes.length === 0) return;
    save.mutate({ absenceId: absence.id, changes }, {
      onSuccess: () => { toast.show("Ore riconosciute salvate"); onClose(); },
      onError: (e) => toast.show(userErrorMessage(e, "Salvataggio non riuscito"), "error"),
    });
  }

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable onPress={save.isPending ? undefined : onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} className="items-center justify-center px-6">
          <Pressable onPress={() => {}} className="w-full rounded-3xl border border-border-2 bg-bg-card p-6">
            <Text className="text-lg font-sans-bold text-t1">Ore di assenza riconosciute</Text>
            <Text className="mt-1 text-xs leading-4 text-t3">
              {ABSENCE_KIND_LABEL[absence.kind]} · {formatAbsenceRange(absence)}. Un giorno lasciato vuoto non viene convertito in ore.
            </Text>
            {!form ? (
              <ActivityIndicator color="#EAB54C" className="mt-6" />
            ) : (
              <>
                {dates.length > 1 ? (
                  <View className="mt-4 flex-row items-center gap-2">
                    <View className="flex-1">
                      <Input value={same} onChangeText={setSame} placeholder="Stesse ore, es. 8" keyboardType="decimal-pad" className="py-2.5" />
                    </View>
                    <RowAction
                      label="Compila i vuoti"
                      disabled={parseCreditHours(same) == null}
                      onPress={() => setDraft(fillEmptyCredits(form, same.trim()))}
                    />
                  </View>
                ) : null}
                <ScrollView style={{ maxHeight: 300 }} className="mt-3" keyboardShouldPersistTaps="handled">
                  {dates.map((d) => (
                    <View key={d} className="flex-row items-center justify-between gap-3 py-1">
                      <Text className="flex-1 text-[13px] text-t2">
                        {formatDate(d)}
                        {conflictOn.has(d) ? <Text className="text-gold"> · da verificare</Text> : null}
                      </Text>
                      <View className="w-24">
                        <Input
                          value={form[d]}
                          onChangeText={(t) => setDraft({ ...form, [d]: t })}
                          placeholder="—"
                          keyboardType="decimal-pad"
                          className={cn("py-2 text-right", parseCreditHours(form[d]) === undefined && "border-error")}
                        />
                      </View>
                    </View>
                  ))}
                </ScrollView>
                <View className="mt-4">
                  <GoldButton label={save.isPending ? "Salvataggio…" : "Salva ore"} disabled={!changes || changes.length === 0 || save.isPending} onPress={onSave} />
                </View>
              </>
            )}
            <Pressable onPress={onClose} disabled={save.isPending} className="mt-2 items-center py-2"><Text className="text-sm text-t4">Annulla</Text></Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** «Ore riconosciute · 16 h su 2 giorni di 4»: una query per riga, come sul web. */
function CreditSummaryLine({ absence }: { absence: Absence }) {
  const credits = useAbsenceHourCredits(absence.id).data;
  if (!credits) return null;
  return <Text className="mt-2 text-xs text-t3">{creditSummary(credits, absenceDays(absence))}</Text>;
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
      style={disabled ? { opacity: 0.4 } : undefined}
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

/** Il riferimento del certificato arriva spesso dopo la visita: si aggiunge qui. */
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
          toast.show("Riferimento salvato");
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
            Riferimento certificato medico
          </Text>
          <Text className="mt-1 text-sm text-t2">
            Malattia · {formatAbsenceRange(absence)}
          </Text>
          <View className="mt-4">
            <Input
              value={protocol}
              onChangeText={setProtocol}
              placeholder="Codice o numero del certificato"
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
