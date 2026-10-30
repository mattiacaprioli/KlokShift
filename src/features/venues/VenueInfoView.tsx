import { useRef, useState } from "react";
import { ScrollView as RNScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { Display } from "@/components/ui/Display";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { TabPanel, TabPills } from "@/components/ui/TabPills";
import { cn } from "@/lib/cn";
import { VenueDetailsCard } from "./VenueDetailsCard";
import type { VenueTab } from "./VenueFormView";
import type { Venue } from "./api";

/**
 * La scheda di una sede **in sola lettura**.
 *
 * Il gemello senza campi di `VenueFormView`, per chi la sede la vede ma non la
 * scrive: un collaboratore invitato sui turni sa dove lavora — indirizzo e
 * descrizione gli servono — ma i dati della sede sono un permesso a sé
 * (`can_manage_venue`), e chiuderla è del titolare e basta.
 *
 * ⚠️ Non è la difesa: quella è la RLS su `venues`, che accetta scritture solo
 * da chi ha «Dati della sede» su quella sede. Qui si evita un modulo che al salvataggio
 * darebbe un errore illeggibile.
 *
 * Gemella di `web/src/venues/VenueInfoCard.tsx`: due markup, stessa regola.
 */
export function VenueInfoView({
  venue,
  tabs: extraTabs = [],
}: {
  venue: Venue;
  /** Le altre sezioni, dopo «Dati sede»: gli stessi tab di `VenueFormView`. */
  tabs?: VenueTab[];
}) {
  const insets = useSafeAreaInsets();
  const [selectedTab, setSelectedTab] = useState("dati");
  const scrollRef = useRef<RNScrollView>(null);
  const tabs =
    extraTabs.length > 0 ? [{ id: "dati", label: "Dati sede" }, ...extraTabs] : [];
  const tab = tabs.some((t) => t.id === selectedTab) ? selectedTab : "dati";

  function onTabChange(id: string) {
    setSelectedTab(id);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  return (
    <View className="flex-1 bg-bg-0">
      <View
        className={cn(
          "shrink-0 gap-4",
          tabs.length > 0 ? "border-b border-border pb-3" : "pb-6"
        )}
        style={{ paddingTop: insets.top + 8 }}
      >
        <View className="px-5">
          <ScreenHeader eyebrow="Sede" title={venue.name} />
        </View>
        {tabs.length > 0 ? (
          <TabPills tabs={tabs} active={tab} onChange={onTabChange} />
        ) : null}
      </View>

      <RNScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: tabs.length > 0 ? 20 : 0,
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 48,
        }}
      >
        <TabPanel active={tab === "dati"}>
          <View className="items-center gap-3">
            <Avatar uri={venue.logo_url ?? undefined} name={venue.name} size={96} />
            <Display className="text-3xl">{venue.name}</Display>
            <Text className="text-xs text-t3">
              I dati della sede li cambia il titolare.
            </Text>
          </View>

          <VenueDetailsCard venue={venue} />
        </TabPanel>

        {extraTabs.map((t) => (
          <TabPanel key={t.id} active={tab === t.id}>
            {t.content}
          </TabPanel>
        ))}
      </RNScrollView>
    </View>
  );
}
