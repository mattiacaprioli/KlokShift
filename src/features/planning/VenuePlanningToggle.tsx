import { Switch } from "react-native";
import { Text, View } from "@/tw";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import type { Venue } from "@/features/venues/api";
import { useSetVenueSeesPlanning } from "./hooks";

/**
 * «Planning visibile all'organico», sulla scheda della sede.
 *
 * Acceso di default: chi lavora in una sede
 * ha ragione di sapere chi c'è in turno con lui, e pretendere un'azione dal
 * titolare avrebbe reso la cosa invisibile quasi ovunque. Lo switch esiste per
 * chi non la vuole.
 *
 * Salva al tocco, senza passare dal pulsante del modulo: `VenueFormView` serve
 * anche alla creazione, dove la sede non ha ancora un id su cui scrivere.
 */
export function VenuePlanningToggle({
  venue,
}: {
  venue: Venue;
  /** @deprecated Non serve più: si scrive per id di sede. Ignorato. */
  ownerId?: string;
}) {
  const toast = useToast();
  const save = useSetVenueSeesPlanning();

  function toggle(value: boolean) {
    save.mutate(
      { venueId: venue.id, visible: value },
      {
        onSuccess: () =>
          toast.show(
            value
              ? "L'organico vede il planning"
              : "Planning non più visibile all'organico"
          ),
        onError: (e) =>
          toast.show(userErrorMessage(e, "Impossibile salvare. Riprova."), "error"),
      }
    );
  }

  return (
    <View className="gap-2">
      <SectionHeader className="mb-0" title="Organico" />
      <Card className="flex-row items-center justify-between gap-3 px-4 py-3.5">
        <View className="flex-1">
          <Text className="text-[15px] font-sans-semibold text-t1">
            Planning visibile all&apos;organico
          </Text>
          <Text className="mt-0.5 text-[13px] text-t3">
            Chi è in organico vede i turni di questa sede e chi ci lavora.
          </Text>
        </View>
        <Switch
          value={venue.staff_sees_planning}
          onValueChange={toggle}
          disabled={save.isPending}
          trackColor={{ false: "#2a241b", true: "#eab54c" }}
          thumbColor="#f8f4ed"
          ios_backgroundColor="#2a241b"
        />
      </Card>
      <Text className="px-1 text-[12px] text-t4">
        Restano privati numeri di telefono, note, documenti e ore. Non vengono
        mai mostrati i rifiuti né le assenze.
      </Text>
    </View>
  );
}
