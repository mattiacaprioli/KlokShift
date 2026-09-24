import { Switch } from "react-native";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import type { Venue } from "@/features/venues/api";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { Text, View } from "@/tw";
import { useSetVenueClockMethod } from "./hooks";

/** Metodo predefinito di una singola sede, per chi ha il permesso Ore. */
export function VenueClockMethodCard({ venue }: { venue: Venue }) {
  const toast = useToast();
  const save = useSetVenueClockMethod();
  const appEnabled = venue.clock_method === "app";

  function toggle(value: boolean) {
    save.mutate(
      { venueId: venue.id, method: value ? "app" : "manual" },
      {
        onSuccess: () =>
          toast.show(
            value
              ? `Timbratura app attivata per ${venue.name}`
              : `Metodo manuale attivato per ${venue.name}`
          ),
        onError: (error) =>
          toast.show(userErrorMessage(error, "Impossibile salvare. Riprova."), "error"),
      }
    );
  }

  return (
    <View className="gap-2">
      <SectionHeader
        className="mb-0"
        title={`Timbrature · ${venue.name}`}
      />
      <Card className="flex-row items-center justify-between gap-3 px-4 py-3.5">
        <View className="flex-1">
          <Text className="text-[15px] font-sans-semibold text-t1">
            Timbratura dall’app
          </Text>
          <Text className="mt-0.5 text-[13px] leading-5 text-t3">
            {appEnabled
              ? "Attiva: entrata e uscita si registrano dal telefono."
              : "Disattiva: le ore vengono inserite da chi gestisce."}
          </Text>
        </View>
        <Switch
          value={appEnabled}
          onValueChange={toggle}
          disabled={save.isPending}
          accessibilityLabel={`Timbratura dall’app per ${venue.name}`}
          trackColor={{ false: "#2a241b", true: "#eab54c" }}
          thumbColor="#f8f4ed"
          ios_backgroundColor="#2a241b"
        />
      </Card>
      <Text className="px-1 text-[12px] leading-5 text-t4">
        Vale solo per questa sede e per chi usa «Come la sede». Le impostazioni
        personali dello staff non cambiano.
      </Text>
    </View>
  );
}
