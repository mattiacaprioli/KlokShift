import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { Mono } from "@/components/ui/Mono";
import { Pill } from "@/components/ui/Pill";
import {
  formatHours,
  formatRelativeStart,
  formatShiftRange,
  shiftDurationHours,
} from "@/lib/format";
import { Text, View } from "@/tw";
import type { AgendaItem } from "./agenda";

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
  const venueName = shift.venue?.name ?? "Locale";
  const canRespond = item.status === "assigned";

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
      <Mono className="mt-1">
        {formatHours(shiftDurationHours(shift.start_time, shift.end_time))}
      </Mono>

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

      {/* Confermato: una riga verde, perché questa card non ha la barra di
          stato delle altre e senza di essa un turno già confermato è identico a
          uno che aspetta ancora una risposta. */}
      {item.status === "confirmed" ? (
        <View className="mt-4 flex-row">
          <Pill label="Presenza confermata" variant="accepted" />
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
