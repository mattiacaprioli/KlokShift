import { useRouter } from "expo-router";
import { View, Text } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { GhostButton } from "@/components/ui/GhostButton";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useStartWorkspaceTrial } from "./hooks";
import { workspaceAccessMessage } from "./access";
import { userErrorMessage } from "@/lib/errors";

/** Stato neutro, senza prezzi, checkout o inviti all'acquisto. */
export function WorkspaceAccessCard() {
  const router = useRouter();
  const { workspaceId, access, accessPending, isOwner, historyVenueIds, canAny, refetch } = useOwnerVenues();
  const trial = useStartWorkspaceTrial();
  if (!workspaceId) return null;
  const date = (value: string) => new Date(value).toLocaleString("it-IT", { timeZone: "Europe/Rome" });
  return (
    <View className="gap-2 rounded-3xl border border-border-2 bg-bg-card p-4">
      <Text className="font-sans-bold text-base text-t1">Stato dell’azienda</Text>
      <Text className="text-sm text-t2">{accessPending ? "Verifica dello stato…" : workspaceAccessMessage(access)}</Text>
      {access?.operational_until ? <Text className="text-xs text-t3">Fine operatività: {date(access.operational_until)}</Text> : null}
      {access?.state === "archive" && access.archive_until ? <Text className="text-xs text-t3">Archivio fino al {date(access.archive_until)}</Text> : null}
      {access?.state === "archive" && access.can_complete_attendance && access.attendance_until ? <Text className="text-xs text-t3">Rettifiche pregresse fino al {date(access.attendance_until)}</Text> : null}
      {access?.plan && access.usage ? <Text className="text-xs text-t3">{access.plan === "base" ? "Base" : "Team"} · {access.usage.people} persone{access.limits.people !== null ? ` su ${access.limits.people}` : ""} · {access.usage.venues} sedi aperte su {access.limits.venues}</Text> : null}
      {access?.limits.people === 30 && (access.usage?.people ?? 0) >= 28 ? <Text className="text-xs text-gold">La capacità di 30 persone è vicina o raggiunta. Il lavoro esistente continua.</Text> : null}
      {access?.state === "setup" && isOwner && (access.usage?.venues ?? 0) > 0 ? <GoldButton label="Avvia la prova di 30 giorni" disabled={trial.isPending} onPress={() => trial.mutate(workspaceId)} /> : null}
      {trial.error ? <Text className="text-sm text-t2">{userErrorMessage(trial.error)}</Text> : null}
      {historyVenueIds.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          <GhostButton label="Storico turni" onPress={() => router.push("/(manager)/storico")} />
          {canAny("can_view_hours") ? <GhostButton label="Ore ed export" onPress={() => router.push("/(manager)/ore")} /> : null}
        </View>
      ) : null}
      {!accessPending ? <GhostButton label="Aggiorna stato" onPress={() => void refetch()} /> : null}
    </View>
  );
}
