import { Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/cn";
import type { PlanningPerson } from "./api";

/**
 * Chi lavora su un turno, una riga per persona.
 *
 * Niente `onPress`: la scheda di un collega non si apre. Contiene telefono,
 * note del titolare, documenti e ore — roba che il database non fa nemmeno
 * uscire (vedi `get_staff_planning`), e un tocco che non porta da nessuna parte
 * è meglio di uno che porta a una schermata vuota.
 *
 * Sé stessi si riconosce dal «tu» e dal bordo oro, non dalla posizione:
 * riordinare l'elenco per mettersi in cima romperebbe l'ordine per mansione,
 * che è come la squadra si legge al lavoro.
 */
export function TeamRow({ person }: { person: PlanningPerson }) {
  return (
    <View className="flex-row items-center gap-3 py-1.5">
      <View
        className={cn(
          "rounded-full",
          person.isMe && "border border-border-gold p-0.5"
        )}
      >
        <Avatar uri={person.avatarUrl} name={person.name} size={30} />
      </View>
      <View className="flex-1">
        <Text
          className={cn(
            "text-[14px] text-t1",
            person.isMe ? "font-sans-bold" : "font-sans-semibold"
          )}
          numberOfLines={1}
        >
          {person.isMe ? `${person.name} (tu)` : person.name}
        </Text>
      </View>
      {person.roleName ? (
        <Text className="text-[13px] text-t3" numberOfLines={1}>
          {person.roleName}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Le facce e basta, per quando lo spazio è quello di una card in lista.
 *
 * Si ferma a quattro e conta il resto: cinque avatar su uno schermo da 375pt
 * mangiano la riga del titolo, e chi scorre l'agenda vuole sapere *quanti*
 * sono, non chi sono uno per uno — per quello c'è il dettaglio.
 */
export function TeamAvatars({
  people,
  max = 4,
}: {
  people: PlanningPerson[];
  max?: number;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;

  return (
    <View className="flex-row items-center">
      {shown.map((p, i) => (
        <View
          key={p.venueMemberId}
          // Sovrapposti: l'insieme si legge come un gruppo, non come una fila.
          style={{ marginLeft: i === 0 ? 0 : -8 }}
          className={cn(
            "rounded-full border-2",
            p.isMe ? "border-border-gold" : "border-bg-card"
          )}
        >
          <Avatar uri={p.avatarUrl} name={p.name} size={26} />
        </View>
      ))}
      {rest > 0 ? (
        <Text className="ml-2 text-[13px] text-t3">+{rest}</Text>
      ) : null}
    </View>
  );
}
