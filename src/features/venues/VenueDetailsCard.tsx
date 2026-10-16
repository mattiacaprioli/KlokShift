import { Text, View } from "@/tw";
import { Mono } from "@/components/ui/Mono";
import { clockMethodLabel } from "@/features/clock/methods";
import { formatBreakMinutes } from "@/lib/format";
import type { Venue } from "./api";

/** Dati e impostazioni in sola lettura, nel Profilo e nel dettaglio sede. */
export function VenueDetailsCard({
  venue,
  showCity = true,
}: {
  venue: Venue;
  /** Nel Profilo la città è già sotto il nome della sede. */
  showCity?: boolean;
}) {
  const details: [string, string | null][] = [
    ["Città", showCity ? venue.city : null],
    ["Attività", venue.cuisine_type],
    ["Indirizzo", venue.address],
  ];
  const settings: [string, string][] = [
    ["Timbratura predefinita", clockMethodLabel(venue.clock_method)],
    ["Pausa", venue.break_paid ? "Retribuita" : "Non retribuita"],
    [
      "Pausa suggerita",
      venue.break_rule_after_minutes != null && venue.break_rule_minutes != null
        ? `${formatBreakMinutes(venue.break_rule_minutes)} nei turni oltre ${formatBreakMinutes(venue.break_rule_after_minutes)}`
        : "Non impostata",
    ],
    [
      "Planning per l’organico",
      venue.staff_sees_planning
        ? "Tutti i turni della sede"
        : "Solo i propri turni",
    ],
  ];

  return (
    <View className="gap-4 rounded-3xl border border-border-2 bg-bg-card p-5">
      <Mono>La tua sede</Mono>
      {venue.description ? (
        <Text className="text-sm leading-5 text-t2">{venue.description}</Text>
      ) : null}
      {details.map(([label, value]) => value ? (
        <View key={label} className="gap-0.5">
          <Mono>{label}</Mono>
          <Text className="text-sm text-t2">{value}</Text>
        </View>
      ) : null)}
      <View className="gap-4 border-t border-border-2 pt-4">
        {settings.map(([label, value]) => (
          <View key={label} className="gap-0.5">
            <Mono>{label}</Mono>
            <Text className="text-sm text-t2">{value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
