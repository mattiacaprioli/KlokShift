import { useRouter } from "expo-router";
import { Text, View } from "@/tw";
import { EmptyState } from "@/components/ui/EmptyState";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { cn } from "@/lib/cn";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { useRespondToInvite } from "@/features/workspace/hooks";
import type { Membership } from "@/features/workspace/types";
import { useOwnerVenues } from "./OwnerVenues";

/**
 * Chi gestisce non ha (ancora) nessuna sede.
 *
 * Fino al 14/09/2026 questo era un **gate**: una porta davanti a tutto, perché
 * senza una sede attiva nessuna schermata sapeva cosa guardare. Ora non c'è più
 * una sede da scegliere, quindi non c'è più una porta: è uno stato vuoto, e ogni
 * schermata che ha davvero bisogno di una sede lo mostra al posto del proprio
 * contenuto.
 *
 * ⚠️ La home **non** lo usa: saluta, mostra i KPI a zero e invita a creare il
 * prima sede. Chi apre l'app la prima volta non deve trovare un muro.
 *
 * Chi si è registrato per gestire una sede e non ha ancora un'azienda passa dallo
 * stesso pulsante: `venue/new` apre azienda e sede in un colpo. Se qualcuno lo ha
 * già invitato in un'azienda, l'invito compare qui sopra — accettarlo è più
 * probabile che aprirne una nuova.
 */
export function NoVenuesState({
  subtitle = "Ti serve una sede prima di organizzare i turni.",
  className,
}: {
  subtitle?: string;
  className?: string;
}) {
  const router = useRouter();
  const { workspaceId, pendingInvites } = useOwnerVenues();
  return (
    <View className={cn("mt-6 gap-4", className)}>
      {pendingInvites.map((invite) => (
        <InviteCard key={invite.member_id} invite={invite} />
      ))}
      <View>
        <EmptyState
          title="Configura la tua sede"
          subtitle={
            workspaceId
              ? subtitle
              : "Apri la tua azienda con la prima sede: ci vuole un minuto."
          }
        />
        <GoldButton
          className="mt-2"
          label={workspaceId ? "Configura sede" : "Crea la prima sede"}
          onPress={() => router.push("/(manager)/venue/new")}
        />
      </View>
    </View>
  );
}

/** Un invito ricevuto: accettare è il consenso, senza non si entra in organico. */
function InviteCard({ invite }: { invite: Membership }) {
  const toast = useToast();
  const respond = useRespondToInvite();

  function answer(accept: boolean) {
    respond.mutate(
      { memberId: invite.member_id, accept },
      {
        onSuccess: () =>
          toast.show(accept ? "Invito accettato" : "Invito rifiutato"),
        onError: (e) =>
          toast.show(userErrorMessage(e, "Operazione non riuscita."), "error"),
      }
    );
  }

  return (
    <View className="gap-3 rounded-3xl border border-border-2 bg-bg-card p-4">
      <Text className="text-base font-sans-bold text-t1">
        {invite.workspace_name} ti ha invitato
      </Text>
      <Text className="text-[13px] leading-5 text-t3">
        Accettando entri nell&apos;organico e la sede vede i tuoi turni.
      </Text>
      <View className="flex-row gap-2.5">
        <GoldButton
          className="flex-1"
          label="Accetta"
          disabled={respond.isPending}
          onPress={() => answer(true)}
        />
        <GhostButton
          label="Rifiuta"
          disabled={respond.isPending}
          onPress={() => answer(false)}
        />
      </View>
    </View>
  );
}
