import { useRouter } from "expo-router";
import { ActivityIndicator } from "react-native";
import { Pressable, Text, View } from "@/tw";
import { Chip } from "@/components/ui/Chip";
import { Mono } from "@/components/ui/Mono";
import { useVenueRoles } from "./hooks";

type Props = {
  venueId: string | undefined;
  /** Id dei ruoli selezionati. */
  value: string[];
  onChange: (roleIds: string[]) => void;
  label?: string;
};

/**
 * I ruoli di una persona dell'organico: scelta **multipla** sui ruoli del
 * sede. Prima era un ruolo solo, ma chi fa il cameriere il venerdì e il barman
 * il sabato non era rappresentabile — e sul turno si sceglie poi quale dei due
 * ricopre quel giorno.
 *
 * Se la sede non ha ancora creato nessun ruolo il campo non finge di essere
 * vuoto: porta dove si creano.
 */
export function RoleMultiSelect({
  venueId,
  value,
  onChange,
  label = "Ruoli",
}: Props) {
  const router = useRouter();
  const rolesQuery = useVenueRoles(venueId);
  const roles = rolesQuery.data ?? [];

  function toggle(id: string) {
    onChange(
      value.includes(id) ? value.filter((r) => r !== id) : [...value, id]
    );
  }

  return (
    <View className="gap-2">
      <Mono>{label}</Mono>
      {rolesQuery.isLoading ? (
        <ActivityIndicator color="#EAB54C" className="self-start" />
      ) : roles.length === 0 ? (
        <Pressable onPress={() => router.push("/(manager)/ruoli")} hitSlop={8}>
          <Text className="text-[13px] leading-5 text-t3">
            Non hai ancora creato i ruoli della tua sede.{" "}
            <Text className="font-sans-semibold text-gold">Creali ora</Text>
          </Text>
        </Pressable>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          {roles.map((r) => {
            const on = value.includes(r.id);
            return (
              <Chip
                key={r.id}
                label={r.name}
                active={on}
                gold={on}
                onPress={() => toggle(r.id)}
              />
            );
          })}
        </View>
      )}
    </View>
  );
}
