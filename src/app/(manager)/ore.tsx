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
import { exportHoursCsv, exportHoursPdf } from "@/lib/export";
import { useToast } from "@/providers/Toast";
import { useAuth } from "@/lib/auth";
import { useActiveVenue } from "@/features/venues/ActiveVenue";
import { companyName } from "@/features/venues/companyName";
import { useOwnerHoursSummary } from "@/features/assignments/hooks";
import {
  groupHoursByPerson,
  venueCount,
} from "@/features/assignments/hoursSummary";

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
 * Non c'è un selettore di sede, di proposito: chi lavora in due locali dello stesso
 * titolare ha una sola busta paga, e il numero che serve è il totale. Lo split per
 * sede sta nella riga espandibile — è quello che serve al titolare per capire dove
 * è finito il costo del lavoro, non al commercialista.
 *
 * Con una sola sede nessuna riga si espande: la pagina è identica a prima del
 * multi-sede.
 */
export default function VenueHoursScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { profile } = useAuth();
  const { ownerId, venues } = useActiveVenue();

  const [month, setMonth] = useState(currentMonth());
  const atCurrentMonth = month >= currentMonth();
  // Quali righe sono aperte. Un Set e non un singolo id: due persone in due sedi
  // si guardano insieme, e chiudere la prima per aprire la seconda è un tap in più.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const query = useOwnerHoursSummary(ownerId, month);
  const rows = query.data ?? [];
  const people = groupHoursByPerson(rows);
  const venues_n = venueCount(rows);

  const totalHours = people.reduce((s, p) => s + p.hours, 0);
  const totalShifts = people.reduce((s, p) => s + p.shifts_count, 0);
  const maxHours = people.reduce((m, p) => Math.max(m, p.hours), 0);
  const label = monthLabel(month);

  function toggle(personId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }

  async function onExport(kind: "pdf" | "csv") {
    if (people.length === 0) return;
    const company = companyName(venues, profile?.full_name);
    try {
      if (kind === "pdf") {
        await exportHoursPdf(company, label, people, totalHours);
      } else {
        await exportHoursCsv(company, label, people);
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

      {query.isLoading ? (
        <ActivityIndicator color="#EAB54C" className="mt-10" />
      ) : query.isError ? (
        <QueryError onRetry={() => query.refetch()} />
      ) : people.length === 0 ? (
        <EmptyState
          title="Nessuna ora registrata"
          subtitle="Le ore dei turni interni conclusi di questo mese, in tutte le tue sedi, compariranno qui."
        />
      ) : (
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
              {venues_n > 1 ? ` · ${venues_n} sedi` : ""}
            </Text>
          </Card>

          <View className="gap-4">
            {people.map((p) => {
              // Il chevron appare solo a chi ha davvero più di una sede: per gli
              // altri non c'è niente da espandere, e un affordance che non porta
              // da nessuna parte è peggio di nessun affordance.
              const splittable = p.venues.length > 1;
              const open = expanded.has(p.person_id);
              return (
                <View key={p.person_id} className="gap-2">
                  <Pressable
                    disabled={!splittable}
                    onPress={() => toggle(p.person_id)}
                    hitSlop={6}
                    className="flex-row items-center justify-between"
                  >
                    <View className="flex-1">
                      <Text className="text-sm font-sans-semibold text-t1">
                        {p.person_name}
                      </Text>
                      <Text className="text-xs text-t3">
                        {p.roles ?? "—"} · {p.shifts_count} turni
                        {splittable ? ` · ${p.venues.length} sedi` : ""}
                      </Text>
                    </View>
                    <Text className="text-sm font-sans-bold text-gold">
                      {formatHours(p.hours)}
                    </Text>
                    {splittable ? (
                      <Icon
                        name="chevR"
                        size={16}
                        color="#8C8579"
                        style={{
                          marginLeft: 6,
                          transform: [{ rotate: open ? "90deg" : "0deg" }],
                        }}
                      />
                    ) : null}
                  </Pressable>

                  <ProgressBar progress={maxHours > 0 ? p.hours / maxHours : 0} />

                  {splittable && open ? (
                    <View className="mt-1 gap-1.5 pl-3">
                      {p.venues.map((v) => (
                        <View
                          key={v.venue_id}
                          className="flex-row items-baseline justify-between"
                        >
                          <Text className="flex-1 text-xs text-t3">
                            {v.venue_name}
                            {v.venue_closed ? " (chiusa)" : ""}
                            {v.roles ? ` · ${v.roles}` : ""} · {v.shifts_count}{" "}
                            turni
                          </Text>
                          <Text className="text-xs font-sans-semibold text-t2">
                            {formatHours(v.hours)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>

          <View className="mt-2 gap-2.5">
            <GoldButton label="Esporta PDF" onPress={() => onExport("pdf")} />
            <GhostButton label="Esporta CSV" onPress={() => onExport("csv")} />
          </View>
        </>
      )}
    </ScrollView>
  );
}
