import { useRouter } from "expo-router";
import { View, Text } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { workspaceAccessMessage } from "./access";

/**
 * Stato neutro, senza prezzi, checkout o inviti all'acquisto (App Store 3.1.3).
 *
 * Dal 22/11 nell'app niente nome del piano, limiti né avviso «vicino al limite»
 * (sono un invito a passare al piano superiore) e niente «Aggiorna», che accanto
 * a un abbonamento si legge «Upgrade»: si ricarica trascinando in giù la pagina.
 * Tutto questo resta sulla dashboard web.
 *
 * Sta in fondo al Menu, che ha già Storico e Ore fra le sue righe: qui non si
 * ripetono (fino al 30/10 erano due pulsanti in più).
 */
export function WorkspaceAccessCard() {
  const router = useRouter();
  const { workspaceId, access, accessPending, isOwner } = useOwnerVenues();
  if (!workspaceId) return null;
  const date = (value: string) => new Date(value).toLocaleString("it-IT", { timeZone: "Europe/Rome" });
  return (
    <View className="gap-2 rounded-3xl border border-border-2 bg-bg-card p-4">
      <Text className="font-sans-bold text-base text-t1">Stato dell’azienda</Text>
      <Text className="text-sm text-t2">{accessPending ? "Verifica dello stato…" : workspaceAccessMessage(access)}</Text>
      {access?.operational_until ? <Text className="text-xs text-t3">Attiva fino al {date(access.operational_until)}</Text> : null}
      {access?.state === "archive" && access.archive_until ? <Text className="text-xs text-t3">Archivio fino al {date(access.archive_until)}</Text> : null}
      {access?.state === "archive" && access.can_complete_attendance && access.attendance_until ? <Text className="text-xs text-t3">Correzioni alle presenze passate fino al {date(access.attendance_until)}</Text> : null}
      {access?.usage ? (
        <Text className="text-xs text-t3">
          {access.usage.people} {access.usage.people === 1 ? "persona" : "persone"} · {access.usage.venues}{" "}
          {access.usage.venues === 1 ? "sede aperta" : "sedi aperte"}
        </Text>
      ) : null}
      {/* La prova si avvia da una schermata sola, che dice cosa comporta. */}
      {access?.state === "setup" && isOwner && (access.usage?.venues ?? 0) > 0 ? <GoldButton className="mt-2" label="Avvia la prova di 30 giorni" onPress={() => router.push("/(manager)/prova")} /> : null}
    </View>
  );
}
