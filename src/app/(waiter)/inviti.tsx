import { RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useRespondToInvite } from "@/features/workspace/hooks";
import type { Membership } from "@/features/workspace/types";

/**
 * Un invito ricevuto: entrare nell'organico di un'azienda, o collaborare alla
 * sua gestione.
 *
 * ⚠️ **Accettare è il consenso.** Finché non lo si fa, l'azienda ha una scheda
 * con un nome ma non vede i turni, le ore o i documenti di questa persona: lo
 * garantisce il DB (`status = 'invited'` non compare in nessun perimetro), non
 * questa schermata.
 */
function InviteCard({ invite }: { invite: Membership }) {
  const toast = useToast();
  const respond = useRespondToInvite();

  const isCollaborator = invite.authority !== "none";
  const venueNames = [...new Set(invite.works.map((w) => w.venue_name))];
  const logo = invite.venues.find((v) => v.logo_url)?.logo_url ?? undefined;

  function answer(accept: boolean) {
    respond.mutate(
      { memberId: invite.member_id, accept },
      {
        onSuccess: () =>
          toast.show(
            accept
              ? isCollaborator
                ? `Ora gestisci ${invite.workspace_name}`
                : `Ora fai parte dell'organico di ${invite.workspace_name}`
              : "Invito rifiutato"
          ),
        onError: (e) => toast.show(userErrorMessage(e), "error"),
      }
    );
  }

  return (
    <Card className="rounded-3xl border-border-2 p-5">
      <View className="flex-row items-center gap-3">
        <Avatar uri={logo} name={invite.workspace_name} size={48} />
        <View className="flex-1">
          <Text className="text-base font-sans-bold text-t1">
            {invite.workspace_name}
          </Text>
          {venueNames.length > 0 ? (
            <Text className="text-xs text-t3">{venueNames.join(" · ")}</Text>
          ) : null}
        </View>
      </View>
      <Text className="mt-3 text-sm text-t2">
        {isCollaborator
          ? "Ti ha invitato a collaborare alla gestione."
          : `Ti ha invitato nel suo organico${
              invite.works.some((w) => w.employment_type === "fisso")
                ? " come dipendente fisso"
                : " a chiamata"
            }.`}
      </Text>
      <View className="mt-4 gap-2.5">
        <GoldButton
          label={respond.isPending ? "Attendere…" : "Accetta"}
          disabled={respond.isPending}
          onPress={() => answer(true)}
        />
        <GhostButton
          label="Rifiuta"
          disabled={respond.isPending}
          onPress={() => answer(false)}
        />
      </View>
    </Card>
  );
}

export default function WaiterInvitesScreen() {
  const insets = useSafeAreaInsets();
  // Gli inviti arrivano dal contesto, che il provider tiene già aggiornato: non
  // c'è una query in più da fare per questa schermata.
  const { pendingInvites, isPending, isError, refetch } = useOwnerVenues();
  const pull = usePullToRefresh(refetch);

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-5 pb-2">
        <ScreenHeader eyebrow="Collaborazioni" title="Richieste" />
      </View>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: insets.bottom + 24,
          gap: 14,
        }}
        refreshControl={
          <RefreshControl
            tintColor="#EAB54C"
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
          />
        }
      >
        {isError ? (
          <QueryError onRetry={refetch} />
        ) : pendingInvites.length === 0 && !isPending ? (
          <View className="mt-16">
            <EmptyState
              title="Nessuna richiesta"
              subtitle="Quando un'azienda ti invita nel suo organico lo vedrai qui."
            />
          </View>
        ) : (
          pendingInvites.map((inv) => (
            <InviteCard key={inv.member_id} invite={inv} />
          ))
        )}
      </ScrollView>
    </View>
  );
}
