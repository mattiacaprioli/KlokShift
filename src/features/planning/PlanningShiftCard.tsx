import { Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Mono } from "@/components/ui/Mono";
import { cn } from "@/lib/cn";
import {
  formatHours,
  formatTime,
  isOvernightShift,
  shiftDurationHours,
} from "@/lib/format";
import type { PlanningShift } from "./api";
import { TeamAvatars, TeamRow } from "./TeamRow";

/**
 * Un turno del locale, visto da chi ci lavora ma non necessariamente ci è sopra.
 *
 * Stessa impaginazione di `MyShiftCard` — ora a sinistra in cifre tabellari,
 * contenuto a destra — perché le due viste si alternano sotto lo stesso
 * calendario e cambiare struttura fra una e l'altra farebbe ballare la lista a
 * ogni tocco sul selettore.
 *
 * Le differenze sono due, e dicono entrambe qualcosa:
 *   · la barra a sinistra è oro solo sui **propri** turni, così scorrendo la
 *     settimana del locale si ritrova la propria dentro;
 *   · niente bottoni di conferma: il turno di un collega non si conferma.
 *
 * ⚠️ Il tocco **apre l'elenco qui dentro**, non porta al dettaglio turno. Non è
 * una scelta di stile: `(waiter)/shift/[id]` legge la riga da `shifts`, e la
 * policy "shifts: read marketplace or assigned" la nega su un turno a cui non si
 * è assegnati — si arriverebbe a «Turno non trovato». I nomi che servono li ha
 * già questa card, e li ha per una via che al database va bene.
 */
export function PlanningShiftCard({
  shift,
  showVenue,
  expanded,
  onToggle,
}: {
  shift: PlanningShift;
  /** Il nome della sede: serve solo a chi lavora in più di una. */
  showVenue?: boolean;
  /** Aperta: al posto delle facce, l'elenco con nome e mansione. */
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const overnight = isOvernightShift(shift.startTime, shift.endTime);
  const duration = formatHours(
    shiftDurationHours(shift.startTime, shift.endTime)
  );

  return (
    <Card
      className="rounded-3xl border-border-2 p-4"
      onPress={shift.people.length > 0 ? onToggle : undefined}
    >
      <View className="flex-row gap-3.5">
        <View
          className={cn(
            "w-1 rounded-full",
            shift.includesMe ? "bg-gold" : "bg-border-2"
          )}
        />

        <View className="items-start pt-0.5">
          <Text
            className="text-lg font-sans-bold text-t1"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {formatTime(shift.startTime)}
          </Text>
          <View className="flex-row items-start gap-0.5">
            <Text
              className="text-sm text-t2"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {formatTime(shift.endTime)}
            </Text>
            {overnight ? <Mono gold>+1</Mono> : null}
          </View>
          <Mono className="mt-1">{duration}</Mono>
        </View>

        <View className="flex-1">
          {showVenue ? (
            <View className="mb-1.5 flex-row items-center gap-2">
              <Avatar
                uri={shift.venueLogoUrl}
                name={shift.venueName}
                size={22}
              />
              <Text className="flex-1 text-[13px] text-t2" numberOfLines={1}>
                {shift.venueName}
              </Text>
            </View>
          ) : null}

          <Text
            className="text-[15px] font-sans-bold text-t1"
            numberOfLines={1}
          >
            {shift.title}
          </Text>

          {shift.people.length > 0 ? (
            expanded ? (
              <View className="mt-1.5">
                {shift.people.map((p) => (
                  <TeamRow key={p.staffMemberId} person={p} />
                ))}
              </View>
            ) : (
              <View className="mt-2.5 flex-row items-center gap-2">
                <TeamAvatars people={shift.people} />
                <Text className="flex-1 text-[13px] text-t3" numberOfLines={1}>
                  {shift.people.length === 1
                    ? "1 persona"
                    : `${shift.people.length} persone`}
                </Text>
              </View>
            )
          ) : (
            // Un turno senza nessuno non è un errore di caricamento: è un turno
            // che il locale non ha ancora coperto, ed è una delle cose che si
            // viene a cercare qui.
            <Text className="mt-2 text-[13px] text-t4">
              Nessuno in turno per ora
            </Text>
          )}
        </View>
      </View>
    </Card>
  );
}
