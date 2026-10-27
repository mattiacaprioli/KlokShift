import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { Mono } from "@/components/ui/Mono";
import { Pill } from "@/components/ui/Pill";
import {
  formatShiftHours,
  formatRelativeStart,
  formatShiftRange,
} from "@/lib/format";
import { Text, View } from "@/tw";
import {
  clockInOpensAt,
  clockInOpensLabel,
  clockInPhase,
} from "@/features/clock/availability";
import { effectiveClockMethod } from "@/features/clock/methods";
import type { AgendaItem } from "./agenda";

/** Entro quanto dall'apertura dell'entrata la card dice da che ora si timbra. */
const CLOCK_HINT_WITHIN_MS = 12 * 3_600_000;

/**
 * «Timbri l'entrata dalle 18:00»: finché l'entrata non si apre, il turno resta
 * in questa card, e senza la riga non si saprebbe quando arriva il pulsante.
 * Solo per chi timbra dall'app e solo il giorno stesso, non per un turno fra
 * una settimana.
 */
function clockInHint(item: AgendaItem, now: Date = new Date()): string | null {
  if (item.clock) return null;
  const method = effectiveClockMethod(
    item.clock_method,
    item.shift.venue?.clock_method ?? "manual"
  );
  if (method !== "app" || clockInPhase(item.shift, now) !== "early") return null;
  if (clockInOpensAt(item.shift).getTime() - now.getTime() > CLOCK_HINT_WITHIN_MS) {
    return null;
  }
  return `Timbri l'entrata dalle ${clockInOpensLabel(item.shift)}`;
}

/**
 * Il turno imminente, in home.
 *
 * È la domanda per cui si apre l'app — «quando lavoro, e dove» — e prima era
 * la prima di venti card identiche. Qui il tempo che manca è l'elemento più
 * forte della schermata, e se il turno è ancora da confermare la risposta si dà
 * da qui: era l'azione più frequente di tutta l'app e costava tre tocchi.
 */
export function NextShiftCard({
  item,
  onPress,
  onConfirm,
  onDecline,
  pending,
}: {
  item: AgendaItem;
  onPress: () => void;
  onConfirm: () => void;
  onDecline: () => void;
  pending?: boolean;
}) {
  const { shift } = item;
  const venueName = shift.venue?.name ?? "Sede";
  const canRespond = item.status === "assigned";
  const clockHint = clockInHint(item);

  return (
    <Card
      className="rounded-3xl border-border-gold bg-bg-card p-5"
      onPress={onPress}
    >
      {/* Solo il tempo che manca: `formatRelativeStart` nomina già il giorno
          quando serve ("domani alle 19:00", "lun 14 alle 17:00"), e affiancarci
          la data la scriveva due volte di fila. */}
      <Mono gold>{formatRelativeStart(shift.date, shift.start_time)}</Mono>

      <Text
        className="mt-2 text-3xl font-sans-bold text-t1"
        style={{ fontVariant: ["tabular-nums"], letterSpacing: -0.5 }}
      >
        {formatShiftRange(shift.start_time, shift.end_time)}
      </Text>
      <Mono className="mt-1">{formatShiftHours(shift)}</Mono>

      <View className="mt-4 flex-row items-center gap-3">
        <Avatar uri={shift.venue?.logo_url} name={venueName} size={40} />
        <View className="flex-1">
          <Text
            className="text-base font-sans-bold text-t1"
            numberOfLines={1}
          >
            {venueName}
          </Text>
          <Text className="text-[13px] text-t2" numberOfLines={1}>
            {item.role?.name ? `${item.role.name} · ${shift.title}` : shift.title}
          </Text>
        </View>
      </View>

      {clockHint ? (
        <Text className="mt-3 text-[13px] text-t3">{clockHint}</Text>
      ) : null}

      {/* Confermato: una riga verde, perché questa card non ha la barra di
          stato delle altre e senza di essa un turno già confermato è identico a
          uno che aspetta ancora una risposta. «Presenza confermata» solo se
          l'ha confermata davvero: il fisso nasce confermato senza aver detto
          niente (`confirmed_at` nullo), e per lui il turno è semplicemente suo. */}
      {item.status === "confirmed" ? (
        <View className="mt-4 flex-row">
          <Pill
            label={item.confirmed_at ? "Presenza confermata" : "In turno"}
            variant="accepted"
          />
        </View>
      ) : null}

      {canRespond ? (
        <View className="mt-4 flex-row gap-2">
          <GoldButton
            className="flex-1"
            size="sm"
            label={pending ? "Attendere…" : "Confermo"}
            disabled={pending}
            onPress={onConfirm}
          />
          <GhostButton
            className="flex-1"
            size="sm"
            label="Non posso"
            disabled={pending}
            onPress={onDecline}
          />
        </View>
      ) : null}
    </Card>
  );
}
