import { useState } from "react";
import { ActivityIndicator } from "react-native";
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
import { formatHours, todayString } from "@/lib/format";
import {
  exportAbsencesCsv,
  exportHoursCsv,
  exportHoursPdf,
} from "@/lib/export";
import { useToast } from "@/providers/Toast";
import { useAuth } from "@/lib/auth";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { companyName } from "@/features/venues/companyName";
import { useOwnerHoursSummary } from "@/features/assignments/hooks";
import { groupHoursByPerson } from "@/features/assignments/hoursSummary";
import { useOwnerAbsenceSummary } from "@/features/absences/hooks";
import {
  ABSENCE_SUMMARY_NOTE,
  formatSummaryDays,
} from "@/features/absences/summary";

const monthFmt = new Intl.DateTimeFormat("it-IT", {
  month: "long",
  year: "numeric",
});

function currentMonth(): string {
  // Ora locale, non UTC: col vecchio `toISOString()` il primo del mese, fino
  // alle 01:00 (o alle 02:00 con l'ora legale), la pagina si apriva ancora sul
  // mese precedente.
  return todayString().slice(0, 7); // "YYYY-MM"
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const label = monthFmt.format(new Date(y, m - 1, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Le ore del mese di **tutta l'azienda**, una riga per persona.
 *
 * Nessun selettore di sede e nessuno split: chi lavora in due sedi dello stesso
 * titolare ha **una** busta paga, e il numero che serve è il totale. Fino al
 * 14/09/2026 ogni riga si apriva sul dettaglio per sede; è stato tolto perché
 * rispondeva a una domanda che qui non si fa — quella pagina esiste per pagare le
 * persone, non per allocare il costo fra le sedi.
 *
 * Con una sola sede la pagina è identica a prima del multi-sede.
 */
export default function VenueHoursScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { profile } = useAuth();
  const { ownerId, venues } = useOwnerVenues();

  const [month, setMonth] = useState(currentMonth());
  const atCurrentMonth = month >= currentMonth();

  const query = useOwnerHoursSummary(ownerId, month);
  const rows = query.data ?? [];
  // La RPC torna righe (persona × sede); `groupHoursByPerson` le somma per
  // persona, ed è quello che si mostra. **Lo split per sede non si espone più**:
  // la busta paga è una, e quante ore di quel totale siano state fatte a Roma
  // invece che a Milano non è una domanda che questa pagina deve rispondere.
  const people = groupHoursByPerson(rows);
  // Ferie, permessi e malattia del mese: una sezione e un CSV a parte.
  const absenceQuery = useOwnerAbsenceSummary(ownerId, month);
  const absences = absenceQuery.data ?? [];

  const totalHours = people.reduce((s, p) => s + p.hours, 0);
  const totalShifts = people.reduce((s, p) => s + p.shifts_count, 0);
  const maxHours = people.reduce((m, p) => Math.max(m, p.hours), 0);
  const label = monthLabel(month);

  async function onExport(kind: "pdf" | "csv" | "absences") {
    const company = companyName(venues, profile?.full_name);
    try {
      if (kind === "pdf") {
        await exportHoursPdf(company, label, people, totalHours, absences);
      } else if (kind === "csv") {
        await exportHoursCsv(company, label, people);
      } else {
        await exportAbsencesCsv(company, label, absences);
      }
    } catch {
      toast.show("Export non riuscito. Riprova.", "error");
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-bg-0"
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingHorizontal: 20,
        paddingBottom: insets.bottom + 48,
        gap: 20,
      }}
    >
      <ScreenHeader eyebrow="Organico" title="Ore del mese" />

      {/* Selettore mese — pillola unica per non confondersi col back */}
      <View className="self-center flex-row items-center rounded-full border border-border-2 bg-bg-1">
        <Pressable
          onPress={() => setMonth((m) => shiftMonth(m, -1))}
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
          onPress={() => setMonth((m) => shiftMonth(m, 1))}
          hitSlop={8}
          className="px-4 py-2.5"
          style={atCurrentMonth ? { opacity: 0.3 } : undefined}
        >
          <Icon name="chevR" size={18} color="#EAB54C" />
        </Pressable>
      </View>

      {query.isLoading || absenceQuery.isLoading ? (
        <ActivityIndicator color="#EAB54C" className="mt-10" />
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
          subtitle="Le ore dei turni interni conclusi di questo mese, in tutte le tue sedi, compariranno qui."
        />
      ) : (
        <>
          {people.length > 0 ? (
            <>
              <Card className="rounded-3xl border-border-2 px-5 py-4">
                <Mono>Totale mese</Mono>
                <Text
                  className="mt-1 text-3xl font-sans-bold text-t1"
                  style={{ letterSpacing: -0.5 }}
                >
                  {formatHours(totalHours)}
                </Text>
                <Text className="text-xs text-t3">
                  {totalShifts} turni · {people.length}{" "}
                  {people.length === 1 ? "persona" : "persone"}
                </Text>
              </Card>

              <View className="gap-4">
                {people.map((p) => (
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
                        {formatHours(p.hours)}
                      </Text>
                    </View>

                    <ProgressBar progress={maxHours > 0 ? p.hours / maxHours : 0} />
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {absences.length > 0 ? (
            <View className="gap-3">
              <View>
                <Mono gold>Assenze del mese</Mono>
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
            <GoldButton label="Esporta PDF" onPress={() => onExport("pdf")} />
            {people.length > 0 ? (
              <GhostButton
                label="Esporta CSV ore"
                onPress={() => onExport("csv")}
              />
            ) : null}
            {absences.length > 0 ? (
              <GhostButton
                label="Esporta CSV assenze"
                onPress={() => onExport("absences")}
              />
            ) : null}
          </View>
        </>
      )}
    </ScrollView>
  );
}
