import { Pressable, Text, View } from "@/tw";
import { Mono } from "@/components/ui/Mono";
import { useToast } from "@/providers/Toast";
import { useMyClosedVenues, useSetVenueClosed } from "./hooks";

/**
 * Le sedi chiuse dell'azienda, con «Riapri». Solo per il titolare: aprire e
 * chiudere una sede non si delega (`set_venue_closed`).
 *
 * Gemella della parte «Sedi chiuse» di `web/src/venues/VenuesCard.tsx`. Fino al
 * 17/10/2026 l'app chiudeva le sedi promettendo «puoi riaprirla quando vuoi»,
 * ma un «Riapri» non c'era. Senza sedi chiuse la card non si vede.
 */
export function ClosedVenuesCard({ workspaceId }: { workspaceId: string }) {
  const closed = useMyClosedVenues(workspaceId).data ?? [];
  const setClosed = useSetVenueClosed(workspaceId);
  const toast = useToast();

  if (closed.length === 0) return null;

  function reopen(venueId: string, name: string) {
    setClosed.mutate(
      { venueId, closed: false },
      {
        onSuccess: () => toast.show(`${name} riaperta`),
        onError: () => toast.show("Impossibile riaprire. Riprova.", "error"),
      }
    );
  }

  return (
    <View className="gap-3 rounded-3xl border border-border-2 bg-bg-card p-5">
      <Mono>{`Sedi chiuse · ${closed.length}`}</Mono>
      {closed.map((v) => (
        <View
          key={v.id}
          className="flex-row items-center gap-3 rounded-2xl border border-border px-4 py-3"
        >
          <Text className="flex-1 text-sm text-t3" numberOfLines={1}>
            {v.name}
          </Text>
          <Pressable
            onPress={() => reopen(v.id, v.name)}
            disabled={setClosed.isPending}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Riapri ${v.name}`}
          >
            <Text className="text-sm font-sans-semibold text-gold">Riapri</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
