import { ListSkeleton } from "@/components/ui/Skeleton";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { Segmented } from "@/components/ui/Segmented";
import { ChipRow, FilterChip } from "@/components/ui/FilterChip";
import { PickerField } from "@/components/form/ControlledPicker";
import {
  addMonthsToKey,
  formatHours,
  monthKey,
  toDateString,
} from "@/lib/format";
import {
  exportAbsencesCsv,
  exportHoursCsv,
  exportHoursPdf,
} from "@/lib/export";
import { useToast } from "@/providers/Toast";
import { useAuth } from "@/lib/auth";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { companyName } from "@/features/venues/companyName";
import { RECORD_ACTION } from "@/features/shifts/recorded";
import { useHoursToFix, useOwnerHoursSummary } from "@/features/assignments/hooks";
import {
  HOURS_TO_FIX_HINT,
  HOURS_TO_FIX_TITLE,
  hourToFixLabel,
  hourToFixWhen,
  hoursToFixSummary,
} from "@/features/assignments/hoursToFix";
import { groupHoursByPerson } from "@/features/assignments/hoursSummary";
import {
  breakSummaryText,
  exportAvailability,
  monthlyReportRows,
} from "@/features/assignments/monthlyReport";
import {
  filterByPeople,
  monthAsRange,
  peopleInReport,
  periodLabel,
  pruneSelection,
  selectedNames,
  togglePerson,
  validateRange,
  type ReportPeriod,
} from "@/features/assignments/reportPeriod";
import { useOwnerAbsenceSummary } from "@/features/absences/hooks";
import {
  ABSENCE_SUMMARY_NOTE,
  formatSummaryDays,
} from "@/features/absences/summary";

const PERIOD_MODES = [
  { id: "month", label: "Mese" },
  { id: "range", label: "Date" },
] as const;

const asDate = (d: string) => new Date(`${d}T00:00:00`);

/**
 * Le ore di **tutta l'azienda** in un mese o fra due date, una riga per
 * persona; si può restringere a una persona o a un gruppo. Periodo e persone
 * valgono per la pagina **e** per gli export: il file è quello che si vede.
 *
 * Nessun selettore di sede e nessuno split: chi lavora in due sedi dello stesso
 * titolare ha **una** busta paga, e il numero che serve è il totale. Fino al
 * 14/09/2026 ogni riga si apriva sul dettaglio per sede; è stato tolto perché
 * rispondeva a una domanda che qui non si fa — quella pagina esiste per pagare le
 * persone, non per allocare il costo fra le sedi.
 *
 * Con una sola sede la pagina è identica a prima del multi-sede.
 */
/** Righe di «Ore da sistemare» visibili prima di «Mostra tutti». */
const TO_FIX_PREVIEW = 8;

export default function VenueHoursScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { profile } = useAuth();
  const router = useRouter();
  const { workspaceId, venues, historyVenues, canUseOperations, canAny, isMultiVenue } =
    useOwnerVenues();
  // Il turno dimenticato si registra da qui: è una questione di ore, e qui si
  // accorge che mancano (come in 7shifts o Deputy, dal foglio ore).
  const canRecord = canUseOperations && canAny("can_view_hours");

  const [month, setMonth] = useState(monthKey());
  const atCurrentMonth = month >= monthKey();
  const [mode, setMode] = useState<"month" | "range">("month");
  // `range` è quello nei campi, `applied` l'ultimo valido: con le date
  // sbagliate la pagina resta sul periodo di prima, niente query a vuoto.
  const [range, setRange] = useState(() => monthAsRange(monthKey()));
  const [applied, setApplied] = useState(range);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const rangeError = mode === "range" ? validateRange(range.from, range.to) : null;
  const period: ReportPeriod =
    mode === "month" ? { kind: "month", month } : { kind: "range", ...applied };

  function editRange(next: { from: string; to: string }) {
    setRange(next);
    if (!validateRange(next.from, next.to)) setApplied(next);
  }

  const query = useOwnerHoursSummary(workspaceId, period);
  const absenceQuery = useOwnerAbsenceSummary(workspaceId, period);
  // I turni del periodo le cui ore non contano ancora, con il perché: anche chi
  // doveva timbrare e non l'ha fatto, che il riepilogo non nomina.
  const toFix = useHoursToFix(workspaceId, period).data ?? [];
  const [showAllToFix, setShowAllToFix] = useState(false);
  const toFixShown = showAllToFix ? toFix : toFix.slice(0, TO_FIX_PREVIEW);
  const allRows = query.data ?? [];
  const allAbsences = absenceQuery.data ?? [];
  // Si sceglie fra chi nel periodo ha ore o assenze; chi non c'è più esce
  // dalla selezione da solo.
  const options = peopleInReport(allRows, allAbsences);
  const selection = pruneSelection(chosen, options);
  const names = selectedNames(selection, options);
  const rows = filterByPeople(allRows, selection);
  // La RPC torna righe (persona × sede); `groupHoursByPerson` le somma per
  // persona, ed è quello che si mostra. **Lo split per sede non si espone più**:
  // la busta paga è una, e quante ore di quel totale siano state fatte a Roma
  // invece che a Milano non è una domanda che questa pagina deve rispondere.
  const people = groupHoursByPerson(rows);
  // Ferie, permessi e malattia del periodo: ore nel consuntivo, giorni nel dettaglio.
  const absences = filterByPeople(allAbsences, selection);
  const report = monthlyReportRows(people, absences);
  const canExport = exportAvailability({
    hoursReady: query.isSuccess,
    absencesReady: absenceQuery.isSuccess,
    reportRows: report.length,
    absenceRows: absences.length,
  });

  const totalHours = people.reduce((s, p) => s + p.hours, 0);
  const totalJustified = report.reduce((s, p) => s + p.justified_hours, 0);
  const totalCoveredHours = report.reduce((s, p) => s + p.covered_hours, 0);
  const totalConflicts = report.reduce((s, p) => s + p.conflict_hours, 0);
  const totalUntracked = report.reduce((s, p) => s + p.untracked_hours, 0);
  const totalShifts = people.reduce((s, p) => s + p.shifts_count, 0);
  const maxHours = people.reduce((m, p) => Math.max(m, p.hours), 0);
  const label = periodLabel(period);

  async function onExport(kind: "pdf" | "csv" | "absences") {
    if (!(kind === "absences" ? canExport.absences : canExport.monthly)) return;
      const company = companyName(venues.length > 0 ? venues : historyVenues, profile?.full_name);
    try {
      if (kind === "pdf") {
        await exportHoursPdf(company, label, people, totalHours, absences, names);
      } else if (kind === "csv") {
        await exportHoursCsv(company, label, people, absences, names);
      } else {
        await exportAbsencesCsv(company, label, absences, names);
      }
    } catch {
      toast.show("Export non riuscito. Riprova.", "error");
    }
  }

  return (
    <View className="flex-1 bg-bg-0">
      <View className="shrink-0 px-5 pb-5" style={{ paddingTop: insets.top + 8 }}>
        <ScreenHeader
          eyebrow="Organico"
          title="Ore"
          right={
            canRecord ? (
              <Pressable
                onPress={() => router.push("/(manager)/shift/record")}
                accessibilityRole="button"
                accessibilityLabel={RECORD_ACTION}
                className="rounded-full border border-border-gold bg-bg-2 px-3 py-1.5"
              >
                <Mono gold>+ Turno già fatto</Mono>
              </Pressable>
            ) : undefined
          }
        />
      </View>

      <ScrollView
        className="flex-1 bg-bg-0"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 48,
          gap: 20,
        }}
      >
        {/* Mese (il caso di tutti i mesi) o due date libere, per mandare al
            consulente anche una quindicina o un periodo a cavallo. */}
        <Segmented
          options={PERIOD_MODES}
          value={mode}
          onChange={(id) => {
            // Si entra in «Date» dal mese che si stava guardando.
            if (id === "range" && mode === "month") editRange(monthAsRange(month));
            setMode(id);
          }}
        />

        {mode === "range" ? (
          <View className="gap-3">
            <PickerField
              mode="date"
              label="Dal"
              value={asDate(range.from)}
              onChange={(d) => editRange({ ...range, from: toDateString(d) })}
            />
            <PickerField
              mode="date"
              label="Al"
              value={asDate(range.to)}
              onChange={(d) => editRange({ ...range, to: toDateString(d) })}
            />
            {rangeError ? (
              <Text className="text-xs text-error">{rangeError}</Text>
            ) : (
              <Text className="text-xs text-t3">{label}</Text>
            )}
          </View>
        ) : (
        /* Selettore mese — pillola unica per non confondersi col back */
        <View className="self-center flex-row items-center rounded-full border border-border-2 bg-bg-1">
          <Pressable
            onPress={() => setMonth((m) => addMonthsToKey(m, -1))}
            hitSlop={8}
            className="px-4 py-2.5"
          >
            <Icon name="chevL" size={18} color="#EAB54C" />
          </Pressable>
          <Text
            className="text-center text-base font-sans-semibold text-t1"
            style={{ minWidth: 150 }}
          >
            {label}
          </Text>
          <Pressable
            disabled={atCurrentMonth}
            onPress={() => setMonth((m) => addMonthsToKey(m, 1))}
            hitSlop={8}
            className="px-4 py-2.5"
            style={atCurrentMonth ? { opacity: 0.3 } : undefined}
          >
            <Icon name="chevR" size={18} color="#EAB54C" />
          </Pressable>
        </View>
        )}

        {/* Una persona o un gruppo, per mandare al consulente solo loro. */}
        {options.length > 1 ? (
          <ChipRow label="Persone">
            <FilterChip
              label="Tutte"
              active={!selection}
              onPress={() => setChosen(null)}
            />
            {options.map((o) => (
              <FilterChip
                key={o.id}
                label={o.name}
                active={!!selection?.includes(o.id)}
                onPress={() =>
                  setChosen(togglePerson(selection, o.id, options.length))
                }
              />
            ))}
          </ChipRow>
        ) : null}

        {/* Prima del riepilogo: è la cosa da fare. Ogni riga apre il turno,
            dove si inseriscono gli orari, l'uscita o si approva. */}
        {toFix.length > 0 ? (
          <View
            className="rounded-3xl border border-warning px-5 py-4"
            // Sfondo inline come nelle `Pill`: `bg-warning/5` passerebbe da
            // `color-mix`, che react-native-css non regge.
            style={{ backgroundColor: "rgba(226,146,47,0.06)" }}
          >
            <Mono>{HOURS_TO_FIX_TITLE}</Mono>
            <Text className="mt-1 text-xs font-sans-semibold text-warning">
              {hoursToFixSummary(toFix)}
            </Text>
            <Text className="mt-1 text-xs leading-4 text-t3">{HOURS_TO_FIX_HINT}</Text>
            <View className="mt-3 gap-2">
              {toFixShown.map((item) => (
                <Pressable
                  key={item.assignment_id}
                  onPress={() => router.push(`/(manager)/shift/${item.shift_id}`)}
                  accessibilityRole="button"
                  className="flex-row items-center gap-3 rounded-2xl border border-border-2 bg-bg-1 px-3 py-2.5"
                >
                  <View className="flex-1">
                    <Text className="text-sm font-sans-semibold text-t1" numberOfLines={1}>
                      {item.member_name}
                    </Text>
                    <Text className="text-xs text-t3" numberOfLines={1}>
                      {hourToFixWhen(item)}
                      {isMultiVenue ? ` · ${item.venue_name}` : ""}
                    </Text>
                    <Text className="text-xs font-sans-semibold text-warning">
                      {hourToFixLabel(item)}
                    </Text>
                  </View>
                  <Icon name="chevR" size={16} color="#8C8579" />
                </Pressable>
              ))}
            </View>
            {toFix.length > TO_FIX_PREVIEW ? (
              <Pressable
                onPress={() => setShowAllToFix((v) => !v)}
                hitSlop={8}
                className="mt-3 self-start"
              >
                <Text className="text-xs font-sans-semibold text-gold">
                  {showAllToFix ? "Mostra meno" : `Mostra tutti (${toFix.length})`}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {query.isLoading || absenceQuery.isLoading ? (
          <ListSkeleton variant="person" label="Caricamento ore…" />
        ) : query.isError || absenceQuery.isError ? (
          <QueryError
            onRetry={() => {
              query.refetch();
              absenceQuery.refetch();
            }}
          />
        ) : people.length === 0 && absences.length === 0 ? (
          <EmptyState
            title="Nessuna ora registrata"
            subtitle="Senza timbratura, le ore compaiono dopo la fine del turno. Le timbrature richiedono approvazione."
          />
        ) : (
          <>
            {report.length > 0 ? (
              <>
                <Card className="rounded-3xl border-border-2 px-5 py-4">
                  <Mono>{selection ? "Riepilogo delle persone scelte" : "Riepilogo del periodo"}</Mono>
                  <View className="mt-3 flex-row flex-wrap gap-4">
                    <View><Text className="text-xs text-t3">Ore Lavorate Effettive</Text><Text className="text-xl font-sans-bold text-t1">{formatHours(totalHours)}</Text></View>
                    <View><Text className="text-xs text-t3">Ore di Assenza Giustificata</Text><Text className="text-xl font-sans-bold text-t1">{formatHours(totalJustified)}</Text></View>
                    <View><Text className="text-xs text-t3">Totale ore coperte</Text><Text className="text-xl font-sans-bold text-gold">{formatHours(totalCoveredHours)}</Text></View>
                  </View>
                  <Text className="mt-2 text-xs text-t3">Senza timbratura, le ore del turno concluso entrano automaticamente e puoi correggerle dal turno. Con la timbratura serve che sia approvata. Il totale somma lavoro e assenze riconosciute; non determina la retribuzione.</Text>
                  {totalConflicts > 0 ? <Text className="mt-2 text-xs text-warning">{formatHours(totalConflicts)} di assenza da verificare, escluse dal totale.</Text> : null}
                  {totalUntracked > 0 ? <Text className="mt-2 text-xs text-warning">{formatHours(totalUntracked)} registrate senza timbratura approvata, escluse dal lavorato effettivo: le trovi in «{HOURS_TO_FIX_TITLE}».</Text> : null}
                  <Text className="text-xs text-t3">
                    {totalShifts} turni · {report.length}{" "}
                    {report.length === 1 ? "persona" : "persone"}
                  </Text>
                </Card>

                <View className="gap-4">
                  {report.map((p) => (
                    <View key={p.person_id} className="gap-2">
                      <View className="flex-row items-center justify-between">
                        <View className="flex-1">
                          <Text className="text-sm font-sans-semibold text-t1">
                            {p.person_name}
                          </Text>
                          <Text className="text-xs text-t3">
                            {p.roles ?? "—"} · {p.shifts_count} turni
                          </Text>
                        </View>
                        <Text className="text-sm font-sans-bold text-gold">
                          {formatHours(p.worked_hours)}
                        </Text>
                      </View>
                      {breakSummaryText(p, formatHours) ? (
                        <Text className="text-xs text-t3">
                          Ore lavorate: {breakSummaryText(p, formatHours)}
                        </Text>
                      ) : null}
                      <Text className="text-xs text-t3">Assenza giustificata {formatHours(p.justified_hours)} · Totale ore coperte {formatHours(p.covered_hours)}</Text>
                      {p.conflict_hours > 0 ? <Text className="text-xs text-warning">Da verificare: {formatHours(p.conflict_hours)} di assenza</Text> : null}
                      {p.untracked_hours > 0 ? <Text className="text-xs text-warning">Senza timbratura: {formatHours(p.untracked_hours)} escluse</Text> : null}
                      <ProgressBar progress={maxHours > 0 ? p.worked_hours / maxHours : 0} />
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {absences.length > 0 ? (
              <View className="gap-3">
                <View>
                  <Mono gold>Assenze del periodo</Mono>
                  <Text className="mt-1 text-xs leading-4 text-t3">
                    {ABSENCE_SUMMARY_NOTE}
                  </Text>
                </View>
                {absences.map((a) => (
                  <Card
                    key={a.person_id}
                    className="gap-1 rounded-2xl border-border-2 px-4 py-3"
                  >
                    <Text className="text-sm font-sans-semibold text-t1">
                      {a.person_name}
                    </Text>
                    <Text className="text-xs text-t2">
                      {[
                        a.ferie_days > 0
                          ? `Ferie ${formatSummaryDays(a.ferie_days)}`
                          : null,
                        a.permesso_days > 0
                          ? `Permessi ${formatSummaryDays(a.permesso_days)}`
                          : null,
                        a.permesso_hours > 0
                          ? `Permessi ${formatHours(a.permesso_hours)}`
                          : null,
                        a.malattia_days > 0
                          ? `Malattia ${formatSummaryDays(a.malattia_days)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                    {a.inps_protocols ? (
                      <Text className="text-xs text-t3">
                        Certificati medici: {a.inps_protocols}
                      </Text>
                    ) : null}
                  </Card>
                ))}
              </View>
            ) : null}

            <View className="mt-2 gap-2.5">
              {canExport.monthly ? (
                <>
                  <GoldButton label="Esporta PDF" onPress={() => onExport("pdf")} />
                  <GhostButton
                    label="Esporta CSV mensile"
                    onPress={() => onExport("csv")}
                  />
                </>
              ) : null}
              {canExport.absences ? (
                <GhostButton
                  label="Esporta CSV assenze"
                  onPress={() => onExport("absences")}
                />
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
