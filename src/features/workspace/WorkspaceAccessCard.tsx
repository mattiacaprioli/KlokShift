import { useRouter } from "expo-router";
import { Pressable, View, Text } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { workspaceAccessMessage } from "./access";

/**
 * Stato neutro, senza prezzi, checkout o inviti all'acquisto.
 *
 * Sta in fondo al Menu, che ha già Storico e Ore fra le sue righe: qui non si
 * ripetono (fino al 30/10 erano due pulsanti in più).
 */
export function WorkspaceAccessCard() {
  const router = useRouter();
  const { workspaceId, access, accessPending, isOwner, refetch } = useOwnerVenues();
  if (!workspaceId) return null;
  const date = (value: string) => new Date(value).toLocaleString("it-IT", { timeZone: "Europe/Rome" });
  return (
    <View className="gap-2 rounded-3xl border border-border-2 bg-bg-card p-4">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="font-sans-bold text-base text-t1">Stato dell’azienda</Text>
        {!accessPending ? (
          <Pressable
            onPress={() => void refetch()}
            accessibilityRole="button"
            accessibilityLabel="Aggiorna lo stato dell’azienda"
            hitSlop={8}
          >
            <Text className="text-sm font-sans-semibold text-gold">Aggiorna</Text>
          </Pressable>
        ) : null}
      </View>
      <Text className="text-sm text-t2">{accessPending ? "Verifica dello stato…" : workspaceAccessMessage(access)}</Text>
      {access?.operational_until ? <Text className="text-xs text-t3">Attiva fino al {date(access.operational_until)}</Text> : null}
      {access?.state === "archive" && access.archive_until ? <Text className="text-xs text-t3">Archivio fino al {date(access.archive_until)}</Text> : null}
      {access?.state === "archive" && access.can_complete_attendance && access.attendance_until ? <Text className="text-xs text-t3">Correzioni alle presenze passate fino al {date(access.attendance_until)}</Text> : null}
      {access?.plan && access.usage ? <Text className="text-xs text-t3">{access.plan === "base" ? "Base" : "Team"} · {access.usage.people} persone{access.limits.people !== null ? ` su ${access.limits.people}` : ""} · {access.usage.venues} sedi aperte su {access.limits.venues}</Text> : null}
      {access?.limits.people === 30 && (access.usage?.people ?? 0) >= 28 ? <Text className="text-xs text-gold">Sei vicino al limite di 30 persone del piano. Turni e persone che hai già restano.</Text> : null}
      {/* La prova si avvia da una schermata sola, che dice cosa comporta. */}
      {access?.state === "setup" && isOwner && (access.usage?.venues ?? 0) > 0 ? <GoldButton className="mt-2" label="Avvia la prova di 30 giorni" onPress={() => router.push("/(manager)/prova")} /> : null}
    </View>
  );
}
