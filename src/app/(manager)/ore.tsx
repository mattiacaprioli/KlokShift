import { ListSkeleton } from "@/components/ui/Skeleton";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView as RNScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, Text, View } from "@/tw";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
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
  exportDailyCsv,
  exportHoursCsv,
  exportHoursPdf,
} from "@/lib/export";
import { useToast } from "@/providers/Toast";
import { useAuth } from "@/lib/auth";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { companyName } from "@/features/venues/companyName";
import { RECORD_ACTION } from "@/features/shifts/recorded";
import {
  fetchOwnerHoursDaily,
  fetchExportCodes,
  fetchWorkspaceSurcharges,
  useWorkspaceSurcharges,
  useHoursToFix,
  useOwnerHoursSummary,
} from "@/features/assignments/hooks";
import {
  HOURS_TO_FIX_HINT,
  HOURS_TO_FIX_TITLE,
  hourToFixLabel,
  hourToFixWhen,
  hoursToFixSummary,
} from "@/features/assignments/hoursToFix";
import { groupHoursByPerson } from "@/features/assignments/hoursSummary";
import {
  NEEDS_CHECK_LABEL,
  needsCheck,
  periodToParams,
} from "@/features/assignments/hoursPerson";
import {
  type ExportCodes,
} from "@/features/assignments/exportCodes";
import {
  EXPORT_BUTTON_LABEL,
  EXPORT_FORMATS,
  buildExportPreview,
  issueLinks,
  toFixInSelection,
  type ExportFormat,
  type ExportIssueTarget,
  type ExportPreview,
} from "@/features/assignments/exportPreview";
import { ExportSheet } from "@/features/assignments/ExportSheet";
import type { HoursDailyRow } from "@/features/assignments/hoursDaily";
import type { PersonHours } from "@/features/assignments/hoursSummary";
import type { MonthlyReportRow } from "@/features/assignments/monthlyReport";
import type { HourToFix } from "@/features/assignments/api";
import type { AbsenceSummaryRow } from "@/features/absences/summary";
import {
  missingContractWarning,
  type SurchargeRow,
} from "@/features/assignments/surcharges";
import {
  exportAvailability,
  monthlyReportRows,
} from "@/features/assignments/monthlyReport";
import {
  filterByPeople,
  monthAsRange,
  monthFromParam,
  periodBounds,
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
  formatSummaryDays,
  missingCertificatesWarning,
} from "@/features/absences/summary";
import { useApproveRegularClockRecords, useRegularClockCount } from "@/features/clock/hooks";
import { approveRegularLabel, approvedRegularToast } from "@/features/clock/autoApprove";
import { userErrorMessage } from "@/lib/errors";
import { useColors } from "@/lib/theme";
import { withAlpha } from "@/constants/colors";

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

/**
 * Quello che il pannello d'export fotografa e legge all'apertura, e con cui
 * scarica: anteprima e file vengono da qui, anche se la pagina intanto cambia.
 */
type ExportData = {
  company: string;
  label: string;
  period: ReportPeriod;
  names: string[];
  people: PersonHours[];
  absences: AbsenceSummaryRow[];
  report: MonthlyReportRow[];
  totalHours: number;
  toFix: HourToFix[];
  certificates: string | null;
  contract: string | null;
  availability: { monthly: boolean; absences: boolean };
  codes: ExportCodes;
  surcharges: SurchargeRow[];
  /** `null` se all'apertura le ore non c'erano: giornaliero, mensile e PDF restano spenti. */
  daily: HoursDailyRow[] | null;
};

export default function VenueHoursScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const { profile } = useAuth();
  const router = useRouter();
  const { workspaceId, venues, historyVenues, canUseOperations, canAny, isMultiVenue, isOwner } =
    useOwnerVenues();
  // Il turno dimenticato si registra da qui: è una questione di ore, e qui si
  // accorge che mancano (come in 7shifts o Deputy, dal foglio ore).
  const canRecord = canUseOperations && canAny("can_view_hours");

  // `?mese=2026-10`: dall'avviso «Ore da sistemare» in Home.
  const { mese } = useLocalSearchParams<{ mese?: string }>();
  const [startMonth] = useState(() => monthFromParam(mese) ?? monthKey());
  const [month, setMonth] = useState(startMonth);
  const atCurrentMonth = month >= monthKey();
  const [mode, setMode] = useState<"month" | "range">("month");
  // `range` è quello nei campi, `applied` l'ultimo valido: con le date
  // sbagliate la pagina resta sul periodo di prima, niente query a vuoto.
  const [range, setRange] = useState(() => monthAsRange(startMonth));
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
  // Le timbrature in orario del periodo si approvano in un tocco, senza aprire
  // i turni uno per uno (decisione del 30/10).
  const regularCount = useRegularClockCount(workspaceId, period, toFix.length > 0).data ?? 0;
  const approveRegular = useApproveRegularClockRecords();
  function onApproveRegular() {
    if (!workspaceId) return;
    approveRegular.mutate(
      { workspaceId, period },
      {
        onSuccess: (n) => toast.show(approvedRegularToast(n)),
        onError: (e) =>
          toast.show(userErrorMessage(e, "Approvazione non riuscita. Riprova."), "error"),
      }
    );
  }
  const [showAllToFix, setShowAllToFix] = useState(false);
  const [showHowCounted, setShowHowCounted] = useState(false);
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
  const certificatesWarning = missingCertificatesWarning(absences);
  // Le maggiorazioni le calcola il database: qui si mostrano «di cui» e basta.
  // Si leggono anche in archivio, come le ore.
  const surchargesData = useWorkspaceSurcharges(
    canAny("can_view_hours") ? workspaceId : undefined,
    period
  ).data;
  const contractWarning = surchargesData
    ? missingContractWarning(surchargesData.noContract, report.map((r) => r.person_id))
    : null;
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

  // Il dettaglio giorno per giorno si scarica solo quando serve, non con la pagina.
  // «Esporta per il consulente»: il pannello che sale dal basso (gemello della
  // dashboard, spec 2026-11-15-anteprima-export-design.md). Codici,
  // maggiorazioni e righe del giorno si leggono UNA volta all'apertura —
  // freschi — e il file si costruisce con quelli. Il giornaliero non si legge
  // mai con la pagina.
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("daily");
  const [exportData, setExportData] = useState<ExportData | null>(null);
  const [exportState, setExportState] = useState<"loading" | "error" | "ready">("loading");
  // Ogni apertura ha il suo numero: una lettura arrivata tardi (pannello
  // chiuso, mese cambiato, riaperto) non sovrascrive quella giusta.
  const exportSeq = useRef(0);

  async function loadExport() {
    const seq = ++exportSeq.current;
    // La fotografia del momento in cui si apre: periodo, persone, ore e avvisi.
    // Anteprima e file usano solo questa, anche se la pagina intanto cambia.
    const snapshot = {
      company: companyName(venues.length > 0 ? venues : historyVenues, profile?.full_name),
      label,
      period,
      names,
      people,
      absences,
      report,
      totalHours,
      toFix: toFixInSelection(toFix, selection),
      certificates: certificatesWarning,
      contract: contractWarning,
      availability: canExport,
    };
    setExportState("loading");
    try {
      const [codes, surcharges, daily] = await Promise.all([
        fetchExportCodes(queryClient, workspaceId),
        canExport.monthly ? fetchWorkspaceSurcharges(queryClient, workspaceId, period) : null,
        canExport.monthly ? fetchOwnerHoursDaily(queryClient, workspaceId, period, selection) : null,
      ]);
      if (seq !== exportSeq.current) return;
      setExportData({
        ...snapshot,
        codes,
        surcharges: surcharges ? filterByPeople(surcharges.rows, selection) : [],
        daily,
      });
      setExportState("ready");
    } catch {
      if (seq === exportSeq.current) setExportState("error");
    }
  }

  function openExport() {
    if (!canExport.monthly && !canExport.absences) return;
    setExportError(null);
    setExportFormat(canExport.monthly ? "daily" : "absences");
    setExportData(null);
    setExportOpen(true);
    void loadExport();
  }

  // I collegamenti delle voci, solo verso pagine che chi esporta può usare.
  const exportLinks = issueLinks({
    canHours: canAny("can_view_hours"),
    canStaff: canAny("can_manage_staff"),
    isOwner,
  });

  function closeExport() {
    exportSeq.current++;
    setExportOpen(false);
  }

  // Solo a pannello aperto: chiuso, niente tabelle ricostruite a ogni render.
  const exportPreviews: Record<ExportFormat, ExportPreview> | null = exportOpen && exportData
    ? (Object.fromEntries(
        EXPORT_FORMATS.map((f) => [
          f.key,
          buildExportPreview({
            format: f.key,
            people: exportData.people,
            absences: exportData.absences,
            daily: exportData.daily,
            codes: exportData.codes,
            surcharges: exportData.surcharges,
            toFix: exportData.toFix,
            warnings: {
              certificates: exportData.certificates,
              contract: exportData.contract,
            },
            availability: exportData.availability,
            codesEditable: canRecord,
          }),
        ])
      ) as Record<ExportFormat, ExportPreview>)
    : null;

  // L'errore dello scarico si dice dentro il pannello: un toast resterebbe
  // sotto il `Modal` e non si vedrebbe.
  const [exportError, setExportError] = useState<string | null>(null);

  async function downloadExport() {
    if (exporting || !exportData || !exportPreviews?.[exportFormat].available) return;
    setExporting(true);
    setExportError(null);
    const { codes, surcharges, daily, company, label: fileLabel, names: fileNames, people: p, absences: a } = exportData;
    try {
      if (exportFormat === "pdf") {
        // Il PDF è da leggere: i codici servono solo ai CSV da importare.
        await exportHoursPdf(company, fileLabel, p, exportData.totalHours, a, fileNames, {
          rows: daily ?? [],
          ...periodBounds(exportData.period),
        }, surcharges);
      } else if (exportFormat === "daily") {
        await exportDailyCsv(company, fileLabel, daily ?? [], fileNames, codes, surcharges);
      } else if (exportFormat === "monthly") {
        await exportHoursCsv(company, fileLabel, p, a, fileNames, codes, surcharges);
      } else {
        await exportAbsencesCsv(company, fileLabel, a, fileNames, codes);
      }
      closeExport();
    } catch {
      setExportError("Export non riuscito. Riprova.");
    } finally {
      setExporting(false);
    }
  }

  // «Ore da sistemare» è in cima alla pagina: il pannello ci riporta lì.
  const scrollRef = useRef<RNScrollView>(null);
  const [toFixY, setToFixY] = useState(0);
  // Dove andare dopo il pannello: si naviga solo a pannello chiuso del tutto
  // (`onClosed`), perché su iOS una schermata aperta mentre un `Modal` si sta
  // chiudendo a volte non compare (come in `(tabs)/turni.tsx`).
  const afterExportClose = useRef<ExportIssueTarget | null>(null);
  function onExportIssue(target: ExportIssueTarget) {
    afterExportClose.current = target;
    closeExport();
  }
  function onExportClosed() {
    const target = afterExportClose.current;
    afterExportClose.current = null;
    if (target === "to_fix") scrollRef.current?.scrollTo({ y: toFixY, animated: true });
    else if (target === "codes") router.push("/codici-consulente");
    else if (target === "absences") router.push("/(manager)/assenze");
    else if (target === "team") router.push("/(manager)/(tabs)/staff");
  }

  return (
    <View className="flex-1 bg-bg-0">
      <View className="shrink-0 px-5 pb-5" style={{ paddingTop: insets.top + 8 }}>
        <ScreenHeader
          // Come nel Menu e nella barra della dashboard: Ore sta in «Ogni giorno».
          eyebrow="Ogni giorno"
          title="Ore"
          right={
            canRecord ? (
              <Pressable
                onPress={() => router.push("/(manager)/shift/record")}
                accessibilityRole="button"
                accessibilityLabel={RECORD_ACTION}
                className="rounded-full border border-border-gold bg-bg-2 px-3 py-1.5"
              >
                <Text className="text-sm font-sans-semibold text-gold">+ Turno già fatto</Text>
              </Pressable>
            ) : undefined
          }
        />
      </View>

      {/* `RNScrollView` e non quello di `@/tw`: serve il ref per tornare a
          «Ore da sistemare» dal pannello d'export (come `staff/[id]`). */}
      <RNScrollView
        ref={scrollRef}
        style={{ flex: 1, backgroundColor: colors.bg0 }}
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
            <Icon name="chevL" size={18} color={colors.gold} />
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
            <Icon name="chevR" size={18} color={colors.gold} />
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
            onLayout={(e) => setToFixY(e.nativeEvent.layout.y)}
            className="rounded-3xl border border-warning px-5 py-4"
            // Sfondo inline come nelle `Pill`: `bg-warning/5` passerebbe da
            // `color-mix`, che react-native-css non regge.
            style={{ backgroundColor: withAlpha(colors.warning, 0.06) }}
          >
            <Mono>{HOURS_TO_FIX_TITLE}</Mono>
            <Text className="mt-1 text-xs font-sans-semibold text-warning">
              {hoursToFixSummary(toFix)}
            </Text>
            <Text className="mt-1 text-xs leading-4 text-t3">{HOURS_TO_FIX_HINT}</Text>
            {regularCount > 0 ? (
              <GoldButton
                className="mt-3"
                size="sm"
                label={approveRegular.isPending ? "Approvo…" : approveRegularLabel(regularCount)}
                disabled={approveRegular.isPending}
                onPress={onApproveRegular}
              />
            ) : null}
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
                  <Icon name="chevR" size={16} color={colors.t3} />
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
                  {/* Un numero grande e poco altro: il dettaglio di ognuno sta
                      nella sua pagina (spec 2026-11-22-ore-mobile-leggibile). */}
                  <Text className="mt-3 text-sm text-t3">Ore lavorate</Text>
                  <Text className="text-4xl font-sans-bold text-t1">{formatHours(totalHours)}</Text>
                  <Text className="mt-1 text-sm text-t3">
                    {totalShifts} {totalShifts === 1 ? "turno" : "turni"} · {report.length}{" "}
                    {report.length === 1 ? "persona" : "persone"}
                  </Text>
                  {totalJustified > 0 ? (
                    <View className="mt-3 gap-1">
                      <Text className="text-base text-t2">Assenze riconosciute {formatHours(totalJustified)}</Text>
                      <Text className="text-base font-sans-semibold text-gold">Totale ore coperte {formatHours(totalCoveredHours)}</Text>
                    </View>
                  ) : null}
                  {totalConflicts > 0 ? <Text className="mt-2 text-sm text-warning">{formatHours(totalConflicts)} di assenza da verificare, escluse dal totale.</Text> : null}
                  {totalUntracked > 0 ? <Text className="mt-2 text-sm text-warning">{formatHours(totalUntracked)} senza timbratura approvata, escluse: le trovi in «{HOURS_TO_FIX_TITLE}».</Text> : null}
                  <Pressable
                    onPress={() => setShowHowCounted((v) => !v)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: showHowCounted }}
                    className="mt-3 self-start"
                  >
                    <Text className="text-sm font-sans-semibold text-gold">
                      {showHowCounted ? "Chiudi" : "Come si contano?"}
                    </Text>
                  </Pressable>
                  {showHowCounted ? (
                    <Text className="mt-2 text-sm leading-5 text-t3">Senza timbratura, le ore del turno concluso entrano da sole e puoi correggerle dal turno. Con la timbratura contano quando è approvata. Il totale somma lavoro e assenze riconosciute; non determina la retribuzione.</Text>
                  ) : null}
                </Card>

                <View className="gap-2">
                  {report.map((p) => (
                    <Pressable
                      key={p.person_id}
                      onPress={() =>
                        router.push({
                          pathname: "/(manager)/ore-persona/[id]",
                          params: { id: p.person_id, ...periodToParams(period) },
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Ore di ${p.person_name}`}
                      className="gap-2 rounded-2xl py-2.5"
                    >
                      <View className="flex-row items-center gap-3">
                        <View className="flex-1">
                          <Text className="text-base font-sans-semibold text-t1" numberOfLines={1}>
                            {p.person_name}
                          </Text>
                          <Text className="text-sm text-t3" numberOfLines={1}>
                            {/* Senza ruolo si dice solo il conto: «— · 10 turni»
                                aveva un trattino appeso davanti. */}
                            {[p.roles, `${p.shifts_count} ${p.shifts_count === 1 ? "turno" : "turni"}`]
                              .filter(Boolean)
                              .join(" · ")}
                          </Text>
                          {needsCheck(p) ? (
                            <Text className="text-sm font-sans-semibold text-warning">
                              {NEEDS_CHECK_LABEL}
                            </Text>
                          ) : null}
                        </View>
                        <Text className="text-lg font-sans-bold text-gold">
                          {formatHours(p.worked_hours)}
                        </Text>
                        <Icon name="chevR" size={18} color={colors.t3} />
                      </View>
                      <ProgressBar progress={maxHours > 0 ? p.worked_hours / maxHours : 0} />
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            {absences.length > 0 ? (
              <View className="gap-3">
                <View>
                  <Mono gold>Assenze del periodo</Mono>
                  <Text className="mt-1 text-sm text-t3">
                    In giorni di calendario. Il dettaglio è nella pagina di ogni persona.
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
              {/* Gli avvisi prima dell'export (certificati, contratto,
                  codici) vivono nel pannello, accanto al file che riguardano. */}
              {canExport.monthly || canExport.absences ? (
                <GoldButton label={EXPORT_BUTTON_LABEL} onPress={openExport} />
              ) : null}
            </View>
          </>
        )}

        {/* Fuori dal ramo «con dati»: un'azienda nuova li prepara prima del
            primo mese, come sulla dashboard. */}
        {query.isLoading || absenceQuery.isLoading ? null : (
          <View className="flex-row justify-center gap-6">
            <Pressable
              onPress={() => router.push("/maggiorazioni")}
              className="items-center py-2"
              accessibilityRole="link"
            >
              <Text className="text-sm font-sans-semibold text-gold">Maggiorazioni</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push("/codici-consulente")}
              className="items-center py-2"
              accessibilityRole="link"
            >
              <Text className="text-sm font-sans-semibold text-gold">Codici per il consulente</Text>
            </Pressable>
          </View>
        )}
      </RNScrollView>

      <ExportSheet
        visible={exportOpen}
        subtitle={`${label}, ${names.length > 0 ? names.join(", ") : `tutte le persone (${report.length})`}`}
        format={exportFormat}
        onFormat={setExportFormat}
        state={exportState}
        preview={exportPreviews}
        links={exportLinks}
        busy={exporting}
        error={exportError}
        onRetry={() => void loadExport()}
        onDownload={() => void downloadExport()}
        onIssue={onExportIssue}
        onClose={closeExport}
        onClosed={onExportClosed}
      />
    </View>
  );
}
