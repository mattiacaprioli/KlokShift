import { useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "@/tw";
import { Mono } from "@/components/ui/Mono";
import { SelectChip } from "@/components/ui/SelectChip";
import { cn } from "@/lib/cn";
import type { VenueRole } from "@/features/roles/api";

type Props = {
  /** I ruoli della sede (già caricati da chi ospita il form). */
  roles: VenueRole[];
  /** Fabbisogno corrente, per id di ruolo. Le voci a 0 valgono "non richiesto". */
  targets: Record<string, number>;
  onChange: (roleId: string, delta: number) => void;
  /** Ruolo scelto per ciascuna persona selezionata, per il conteggio "assegnati". */
  assignedRoleIds: (string | null)[];
};

/**
 * "Fabbisogno per ruolo" del turno interno, condiviso da creazione e modifica.
 *
 * È **additivo**: mostra solo i ruoli già richiesti, più un pulsante che rivela
 * i restanti. Prima disegnava una riga con +/− per OGNI ruolo esistente, il che
 * funzionava con sei ruoli ma diventava un muro di selettori quasi tutti a zero
 * appena la lista cresceva — e ora la lista la scrive la sede, quindi può
 * essere lunga quanto vuole.
 */
export function RoleRequirementsField({
  roles,
  targets,
  onChange,
  assignedRoleIds,
}: Props) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);

  const active = roles.filter((r) => (targets[r.id] ?? 0) > 0);
  const available = roles.filter((r) => (targets[r.id] ?? 0) === 0);

  if (roles.length === 0) {
    return (
      <View className="gap-2">
        <Mono>Fabbisogno per ruolo · facoltativo</Mono>
        <Pressable onPress={() => router.push("/(manager)/ruoli")} hitSlop={8}>
          <Text className="text-[13px] leading-5 text-t3">
            Per chiedere dei ruoli su un turno devi prima crearli.{" "}
            <Text className="font-sans-semibold text-gold">Creali ora</Text>
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="gap-2">
      <Mono>Fabbisogno per ruolo · facoltativo</Mono>

      {active.length === 0 && !picking ? (
        <Text className="text-[13px] leading-5 text-t3">
          Nessun fabbisogno impostato: il turno è coperto da chi selezioni qui
          sotto.
        </Text>
      ) : null}

      <View>
        {active.map((role) => {
          const target = targets[role.id] ?? 0;
          const assigned = assignedRoleIds.filter((r) => r === role.id).length;
          return (
            <View
              key={role.id}
              className="flex-row items-center justify-between py-1.5"
            >
              <View className="flex-1">
                <Text className="text-sm text-t1">{role.name}</Text>
                <Text
                  className={cn(
                    "text-xs",
                    assigned >= target ? "text-success" : "text-t3"
                  )}
                >
                  {assigned}/{target} assegnati
                </Text>
              </View>
              <View className="flex-row items-center gap-4">
                <Pressable
                  onPress={() => onChange(role.id, -1)}
                  hitSlop={8}
                  className="h-8 w-8 items-center justify-center rounded-full border border-border-2 bg-bg-2"
                >
                  <Text className="text-base text-t1">−</Text>
                </Pressable>
                <Text className="w-5 text-center font-sans-semibold text-t1">
                  {target}
                </Text>
                <Pressable
                  onPress={() => onChange(role.id, 1)}
                  hitSlop={8}
                  className="h-8 w-8 items-center justify-center rounded-full border border-border-2 bg-bg-2"
                >
                  <Text className="text-base text-t1">+</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>

      {picking ? (
        <View className="mt-1 flex-row flex-wrap gap-2">
          {available.map((role) => (
            <SelectChip
              key={role.id}
              label={role.name}
              onPress={() => {
                onChange(role.id, 1);
                if (available.length === 1) setPicking(false);
              }}
            />
          ))}
        </View>
      ) : available.length > 0 ? (
        <Pressable
          onPress={() => setPicking(true)}
          hitSlop={8}
          className="mt-1 flex-row items-center gap-2 self-start"
        >
          <Text className="text-base text-gold">+</Text>
          <Text className="text-[13px] font-sans-semibold text-gold">
            Aggiungi ruolo
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
