import { ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useAuth } from "@/lib/auth";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { useToast } from "@/providers/Toast";
import {
  useMyPendingInvites,
  useRespondToInvite,
} from "@/features/staff/hooks";
import type { PendingInvite } from "@/features/staff/api";

function InviteCard({ invite }: { invite: PendingInvite }) {
  const toast = useToast();
  const respond = useRespondToInvite();
  const venueName = invite.venue?.name ?? "Una sede";

  function accept() {
    respond.mutate(
      { staffId: invite.id, accept: true },
      {
        onSuccess: () => toast.show(`Ora fai parte dello staff di ${venueName}`),
        onError: () => toast.show("Operazione non riuscita. Riprova.", "error"),
      }
    );
  }
  function decline() {
    respond.mutate(
      { staffId: invite.id, accept: false },
      {
        onSuccess: () => toast.show("Richiesta rifiutata"),
        onError: () => toast.show("Operazione non riuscita. Riprova.", "error"),
      }
    );
  }

  return (
    <Card className="rounded-3xl border-border-2 p-5">
      <View className="flex-row items-center gap-3">
        <Avatar uri={invite.venue?.logo_url ?? undefined} name={venueName} size={48} />
        <View className="flex-1">
          <Text className="text-base font-sans-bold text-t1">{venueName}</Text>
          {invite.venue?.city ? (
            <Text className="text-xs text-t3">{invite.venue.city}</Text>
          ) : null}
        </View>
      </View>
      <Text className="mt-3 text-sm text-t2">
        Ti ha invitato a entrare nel suo staff
        {invite.employment_type === "fisso" ? " fisso" : " a chiamata"}.
      </Text>
      <View className="mt-4 gap-2.5">
        <GoldButton
          label={respond.isPending ? "Attendere…" : "Accetta"}
          disabled={respond.isPending}
          onPress={accept}
        />
        <GhostButton
          label="Rifiuta"
          disabled={respond.isPending}
          onPress={decline}
        />
      </View>
    </Card>
  );
}

export default function WaiterInvitesScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session!.user.id;

  const query = useMyPendingInvites(userId);
  const invites = query.data ?? [];
  const pull = usePullToRefresh(query.refetch);

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
        {query.isLoading ? (
          <ActivityIndicator color="#EAB54C" className="mt-16" />
        ) : query.isError ? (
          <QueryError onRetry={() => query.refetch()} />
        ) : invites.length === 0 ? (
          <View className="mt-16">
            <EmptyState
              title="Nessuna richiesta"
              subtitle="Quando una sede ti invita nel suo staff lo vedrai qui."
            />
          </View>
        ) : (
          invites.map((inv) => <InviteCard key={inv.id} invite={inv} />)
        )}
      </ScrollView>
    </View>
  );
}
