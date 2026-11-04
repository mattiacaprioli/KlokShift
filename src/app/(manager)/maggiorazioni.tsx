import { useState } from "react";
import { KeyboardAvoidingView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { GhostButton } from "@/components/ui/GhostButton";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/ui/Mono";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { operationsGate } from "@/features/workspace/access";
import {
  useSaveSurchargeRules,
  useSaveVenuePatron,
  useSurchargeRules,
} from "@/features/assignments/hooks";
import {
  BAND_ERROR,
  OVERTIME_HELP,
  PATRON_HELP,
  PCT_ERROR,
  SURCHARGES_HELP,
  isQuarterTime,
  parseSurchargePct,
  rulesChangeNote,
  rulesForMonth,
  type SurchargeRules,
  type SurchargeRulesInput,
} from "@/features/assignments/surcharges";
import { addMonthsToKey, formatMonthKey, monthKey } from "@/lib/format";
import { useToast } from "@/providers/Toast";
import { userErrorMessage } from "@/lib/errors";

/**
 * Le regole delle maggiorazioni dell'azienda (versioni mensili) e il patrono
 * di ogni sede. Le scrive chi ha «Ore» (`save_surcharge_rules`,
 * `save_venue_patron`); le ore le calcola il database.
 */
export default function SurchargesScreen() {
  const insets = useSafeAreaInsets();
  const { workspaceId, venues, isOwner, can } = useOwnerVenues();
  const query = useSurchargeRules(workspaceId);
  const current = monthKey();
  const [month, setMonth] = useState(current);
  const minMonth = addMonthsToKey(current, -12);
  const hourVenues = venues.filter((v) => isOwner || can(v.id, "can_view_hours"));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
        <View className="px-5 pb-2">
          <ScreenHeader eyebrow="Ore" title="Maggiorazioni" />
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: insets.bottom + 24,
            gap: 16,
          }}
        >
          <Text className="text-sm leading-5 text-t2">{SURCHARGES_HELP}</Text>
          {!workspaceId || query.isError ? (
            <QueryError onRetry={() => void query.refetch()} />
          ) : query.isPending ? (
            <ListSkeleton />
          ) : (
            <>
              <View className="gap-2">
                <Mono>Valgono dal mese di</Mono>
                <View className="self-start flex-row items-center rounded-full border border-border-2 bg-bg-1">
                  <Pressable
                    disabled={month <= minMonth}
                    onPress={() => setMonth((m) => addMonthsToKey(m, -1))}
                    hitSlop={8}
                    className="px-4 py-2.5"
                    style={month <= minMonth ? { opacity: 0.3 } : undefined}
                    accessibilityLabel="Mese prima"
                  >
                    <Icon name="chevL" size={18} color="#EAB54C" />
                  </Pressable>
                  <Text className="text-center text-base font-sans-semibold text-t1" style={{ minWidth: 150 }}>
                    {formatMonthKey(month)}
                  </Text>
                  <Pressable
                    disabled={month >= current}
                    onPress={() => setMonth((m) => addMonthsToKey(m, 1))}
                    hitSlop={8}
                    className="px-4 py-2.5"
                    style={month >= current ? { opacity: 0.3 } : undefined}
                    accessibilityLabel="Mese dopo"
                  >
                    <Icon name="chevR" size={18} color="#EAB54C" />
                  </Pressable>
                </View>
                {rulesChangeNote(query.data.versions, month, current) ? (
                  <Text className="text-xs leading-4 text-warning">
                    {rulesChangeNote(query.data.versions, month, current)}
                  </Text>
                ) : null}
              </View>
              <RulesForm
                key={month}
                workspaceId={workspaceId}
                month={month}
                initial={rulesForMonth(query.data.versions, month)}
              />
              {hourVenues.length > 0 ? (
                <PatronsForm
                  workspaceId={workspaceId}
                  venues={hourVenues}
                  patrons={query.data.patrons}
                />
              ) : null}
            </>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const pctInput = (n: number | null) => (n == null ? "" : String(n).replace(".", ","));

function RulesForm({
  workspaceId,
  month,
  initial,
}: {
  workspaceId: string;
  month: string;
  initial: SurchargeRulesInput;
}) {
  const toast = useToast();
  const save = useSaveSurchargeRules(workspaceId);
  const { access, isOwner } = useOwnerVenues();
  const gate = operationsGate(access, { isOwner });
  const [night, setNight] = useState(pctInput(initial.night_pct));
  const [start, setStart] = useState(initial.night_start);
  const [end, setEnd] = useState(initial.night_end);
  const [sunday, setSunday] = useState(pctInput(initial.sunday_pct));
  const [holiday, setHoliday] = useState(pctInput(initial.holiday_pct));
  const [overtime, setOvertime] = useState(pctInput(initial.overtime_pct));

  const parsed = {
    night: parseSurchargePct(night),
    sunday: parseSurchargePct(sunday),
    holiday: parseSurchargePct(holiday),
    overtime: parseSurchargePct(overtime),
  };
  const badBand = !isQuarterTime(start) || !isQuarterTime(end) || start.trim() === end.trim();
  const invalid = Object.values(parsed).some((p) => p.invalid) || badBand;

  async function onSave() {
    if (invalid) return;
    try {
      await save.mutateAsync({
        validFrom: `${month}-01`,
        rules: {
          night_pct: parsed.night.pct,
          night_start: start.trim(),
          night_end: end.trim(),
          sunday_pct: parsed.sunday.pct,
          holiday_pct: parsed.holiday.pct,
          overtime_pct: parsed.overtime.pct,
        },
      });
      toast.show("Maggiorazioni salvate");
    } catch (e) {
      toast.show(userErrorMessage(e), "error");
    }
  }

  const pctField = (label: string, value: string, set: (v: string) => void, bad: boolean) => (
    <View className="gap-1">
      <Input
        label={`${label} (%)`}
        value={value}
        onChangeText={set}
        keyboardType="decimal-pad"
        placeholder="Spenta"
        editable={gate.allowed}
      />
      {bad ? <Text className="text-xs text-error">{PCT_ERROR}</Text> : null}
    </View>
  );

  return (
    <View className="gap-4">
      {pctField("Notturno", night, setNight, parsed.night.invalid)}
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Input label="Dalle" value={start} onChangeText={setStart} placeholder="22:00" editable={gate.allowed} />
        </View>
        <View className="flex-1">
          <Input label="Alle" value={end} onChangeText={setEnd} placeholder="06:00" editable={gate.allowed} />
        </View>
      </View>
      {badBand ? <Text className="text-xs text-error">{BAND_ERROR}</Text> : null}
      {pctField("Domenica", sunday, setSunday, parsed.sunday.invalid)}
      {pctField("Festivi", holiday, setHoliday, parsed.holiday.invalid)}
      {pctField("Straordinario", overtime, setOvertime, parsed.overtime.invalid)}
      <Text className="text-xs leading-4 text-t3">{OVERTIME_HELP}</Text>
      {gate.allowed ? (
        <GoldButton label="Salva" onPress={() => void onSave()} disabled={save.isPending || invalid} />
      ) : (
        <Text className="text-sm leading-5 text-t3">{gate.reason}</Text>
      )}
    </View>
  );
}

function PatronsForm({
  workspaceId,
  venues,
  patrons,
}: {
  workspaceId: string;
  venues: { id: string; name: string }[];
  patrons: SurchargeRules["patrons"];
}) {
  const toast = useToast();
  const save = useSaveVenuePatron(workspaceId);
  const { access, isOwner } = useOwnerVenues();
  const gate = operationsGate(access, { isOwner });
  const initial = (venueId: string) => patrons.find((p) => p.venue_id === venueId);
  const [values, setValues] = useState<Record<string, { day: string; month: string }>>(() => {
    const out: Record<string, { day: string; month: string }> = {};
    for (const v of venues) {
      const p = initial(v.id);
      out[v.id] = { day: p ? String(p.day) : "", month: p ? String(p.month) : "" };
    }
    return out;
  });

  async function onSave() {
    try {
      for (const v of venues) {
        const cur = values[v.id];
        const p = initial(v.id);
        const day = cur.day.trim() === "" ? null : Number(cur.day);
        const mon = cur.month.trim() === "" ? null : Number(cur.month);
        if (day === (p?.day ?? null) && mon === (p?.month ?? null)) continue;
        await save.mutateAsync({ venueId: v.id, day, month: mon });
      }
      toast.show("Patroni salvati");
    } catch (e) {
      toast.show(userErrorMessage(e), "error");
    }
  }

  return (
    <View className="gap-3">
      <Mono>Santo patrono</Mono>
      <Text className="text-xs leading-4 text-t3">{PATRON_HELP}</Text>
      {venues.map((v) => (
        <View key={v.id} className="gap-2">
          <Text className="text-sm font-sans-semibold text-t1">{v.name}</Text>
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Input
                label="Giorno"
                value={values[v.id]?.day ?? ""}
                onChangeText={(t) => setValues((prev) => ({ ...prev, [v.id]: { ...prev[v.id], day: t } }))}
                keyboardType="number-pad"
                maxLength={2}
                editable={gate.allowed}
              />
            </View>
            <View className="flex-1">
              <Input
                label="Mese"
                value={values[v.id]?.month ?? ""}
                onChangeText={(t) => setValues((prev) => ({ ...prev, [v.id]: { ...prev[v.id], month: t } }))}
                keyboardType="number-pad"
                maxLength={2}
                editable={gate.allowed}
              />
            </View>
          </View>
        </View>
      ))}
      {gate.allowed ? (
        <GhostButton label="Salva i patroni" onPress={() => void onSave()} disabled={save.isPending} />
      ) : null}
    </View>
  );
}
