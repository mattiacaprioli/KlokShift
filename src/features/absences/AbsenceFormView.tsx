import { useState } from "react";
import { KeyboardAvoidingView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/ui/Mono";
import { Segmented } from "@/components/ui/Segmented";
import { SelectChip } from "@/components/ui/SelectChip";
import { PickerField } from "@/components/form/ControlledPicker";
import { cn } from "@/lib/cn";
import { toDateString, toTimeString } from "@/lib/format";
import type { AbsenceEmployer, AbsenceInput, AbsenceKind } from "./api";
import { ABSENCE_KINDS, SICK_PRIVACY_HINT } from "./labels";

function atTime(hours: number): Date {
  const d = new Date();
  d.setHours(hours, 0, 0, 0);
  return d;
}

type Props = {
  /**
   * Professionista in più aziende: a chi mandare la richiesta. Con una sola
   * azienda (o dal lato titolare) non si mostra niente.
   */
  employers?: AbsenceEmployer[];
  /** Lato titolare: si registra un'assenza già decisa, non si «chiede». */
  recording?: boolean;
  submitLabel: string;
  pending: boolean;
  onSubmit: (values: AbsenceInput & { workspaceId: string | null }) => void;
};

/**
 * Form di un'assenza: tipo, date, orario per il permesso a ore, nota o
 * protocollo INPS.
 *
 * ⚠️ Per la malattia la nota **non esiste**: al suo posto il testo che ricorda di
 * non scrivere informazioni sulla salute (GDPR art. 9). Non è un campo nascosto,
 * è un campo che non c'è — e `api.ts` non la manderebbe comunque.
 */
export function AbsenceFormView({
  employers = [],
  recording,
  submitLabel,
  pending,
  onSubmit,
}: Props) {
  const insets = useSafeAreaInsets();
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    employers.length === 1 ? employers[0].workspaceId : null
  );
  const [kind, setKind] = useState<AbsenceKind>("ferie");
  const [start, setStart] = useState(() => new Date());
  const [end, setEnd] = useState(() => new Date());
  const [hourly, setHourly] = useState(false);
  const [startTime, setStartTime] = useState(() => atTime(9));
  const [endTime, setEndTime] = useState(() => atTime(13));
  const [note, setNote] = useState("");
  const [protocol, setProtocol] = useState("");

  const sick = kind === "malattia";
  const isHourly = kind === "permesso" && hourly;
  const startDate = toDateString(start);
  const endDate = isHourly ? startDate : toDateString(end);
  const rangeValid = endDate >= startDate;
  const timesValid =
    !isHourly || toTimeString(endTime) > toTimeString(startTime);
  const needsEmployer = employers.length > 1 && !workspaceId;
  const canSubmit = !pending && rangeValid && timesValid && !needsEmployer;

  function onStartChange(d: Date) {
    setStart(d);
    // Spostare l'inizio oltre la fine trascina la fine con sé: è quasi sempre
    // quello che si voleva, e un errore rosso non aiuterebbe.
    if (toDateString(d) > toDateString(end)) setEnd(d);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 8,
          paddingBottom: insets.bottom + 32,
          gap: 20,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {employers.length > 1 ? (
          <View className="gap-2">
            <Mono>A chi la mandi</Mono>
            <View className="flex-row flex-wrap gap-2">
              {employers.map((e) => (
                <SelectChip
                  key={e.memberId}
                  label={e.label}
                  active={workspaceId === e.workspaceId}
                  onPress={() => setWorkspaceId(e.workspaceId)}
                />
              ))}
            </View>
            <Text className="text-xs leading-4 text-t3">
              Ogni azienda decide per sé: se lavori per più titolari, mandane
              una a ciascuno.
            </Text>
          </View>
        ) : null}

        <Segmented options={ABSENCE_KINDS} value={kind} onChange={setKind} />

        {kind === "permesso" ? (
          <View className="flex-row gap-2">
            {[
              { id: false, label: "Giornata intera" },
              { id: true, label: "A ore" },
            ].map((o) => (
              <Pressable
                key={o.label}
                onPress={() => setHourly(o.id)}
                className={cn(
                  "flex-1 items-center rounded-2xl border py-3",
                  hourly === o.id
                    ? "border-gold bg-bg-card"
                    : "border-border-2 bg-bg-2"
                )}
              >
                <Text
                  className={cn(
                    "text-sm",
                    hourly === o.id ? "font-sans-semibold text-t1" : "text-t3"
                  )}
                >
                  {o.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View className="gap-3">
          <PickerField
            mode="date"
            label={isHourly ? "Giorno" : "Dal"}
            value={start}
            onChange={onStartChange}
          />
          {isHourly ? (
            <>
              <PickerField
                mode="time"
                label="Dalle"
                value={startTime}
                onChange={setStartTime}
              />
              <PickerField
                mode="time"
                label="Alle"
                value={endTime}
                onChange={setEndTime}
              />
            </>
          ) : (
            <PickerField mode="date" label="Al" value={end} onChange={setEnd} />
          )}
          {!rangeValid ? (
            <Text className="text-xs text-error">
              La data di fine viene prima di quella di inizio.
            </Text>
          ) : null}
          {!timesValid ? (
            <Text className="text-xs text-error">
              L&apos;ora di fine deve venire dopo quella di inizio.
            </Text>
          ) : null}
        </View>

        {sick ? (
          <View className="gap-3">
            <Input
              label="Numero di protocollo INPS · facoltativo"
              value={protocol}
              onChangeText={setProtocol}
              placeholder="Es. 123456789"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={40}
            />
            {recording ? null : (
              <Text className="text-[13px] leading-5 text-t3">
                {SICK_PRIVACY_HINT}
              </Text>
            )}
          </View>
        ) : (
          <Input
            label={recording ? "Nota · facoltativa" : "Motivo · facoltativo"}
            value={note}
            onChangeText={setNote}
            placeholder={kind === "ferie" ? "Es. Matrimonio" : "Es. Visita"}
            maxLength={300}
            multiline
          />
        )}

        <GoldButton
          className="mt-1"
          label={pending ? "Invio…" : submitLabel}
          disabled={!canSubmit}
          onPress={() =>
            onSubmit({
              workspaceId,
              kind,
              startDate,
              endDate,
              startTime: isHourly ? toTimeString(startTime) : null,
              endTime: isHourly ? toTimeString(endTime) : null,
              note: sick ? null : note,
              inpsProtocol: sick ? protocol : null,
            })
          }
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
