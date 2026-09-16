import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { Display } from "@/components/ui/Display";
import { Mono } from "@/components/ui/Mono";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import type { Venue } from "./api";

/**
 * La scheda di una sede **in sola lettura**.
 *
 * Il gemello senza campi di `VenueFormView`, per chi la sede la vede ma non la
 * scrive: un collaboratore invitato sui turni sa dove lavora — indirizzo e
 * descrizione gli servono — ma i dati della sede sono un permesso a sé
 * (`can_manage_venue`), e chiuderla è del titolare e basta.
 *
 * ⚠️ Non è la difesa: quella è la policy `venues: owner crud`, che accetta
 * scritture dal solo proprietario. Qui si evita un modulo che al salvataggio
 * darebbe un errore illeggibile.
 *
 * Gemella di `web/src/venues/VenueInfoCard.tsx`: due markup, stessa regola.
 */
export function VenueInfoView({ venue }: { venue: Venue }) {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      className="flex-1 bg-bg-0"
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingHorizontal: 20,
        paddingBottom: insets.bottom + 48,
        gap: 24,
      }}
    >
      <ScreenHeader eyebrow="Sede" title={venue.name} />

      <View className="items-center gap-3">
        <Avatar uri={venue.logo_url ?? undefined} name={venue.name} size={96} />
        <Display className="text-3xl">{venue.name}</Display>
        <Text className="text-xs text-t3">
          I dati della sede li cambia il titolare.
        </Text>
      </View>

      <View className="gap-4 rounded-3xl border border-border-2 bg-bg-card p-5">
        {venue.city ? (
          <View className="gap-0.5">
            <Mono>Città</Mono>
            <Text className="text-sm text-t2">{venue.city}</Text>
          </View>
        ) : null}
        {venue.address ? (
          <View className="gap-0.5">
            <Mono>Indirizzo</Mono>
            <Text className="text-sm text-t2">{venue.address}</Text>
          </View>
        ) : null}
        {venue.cuisine_type ? (
          <View className="gap-0.5">
            <Mono>Tipo di sede</Mono>
            <Text className="text-sm text-t2">{venue.cuisine_type}</Text>
          </View>
        ) : null}
        {venue.description ? (
          <Text className="text-sm leading-5 text-t2">{venue.description}</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
