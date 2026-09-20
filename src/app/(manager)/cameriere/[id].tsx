import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { ExperienceTimeline } from "@/components/ui/ExperienceTimeline";
import { GhostButton } from "@/components/ui/GhostButton";
import { Mono } from "@/components/ui/Mono";
import { RatingBadge } from "@/components/ui/RatingBadge";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { WaiterReviewsList } from "@/features/reviews/WaiterReviewsList";
import { REVIEWS_ENABLED } from "@/features/reviews/config";
import { useStartConversation } from "@/features/chat/hooks";
import { useExperiences } from "@/features/experiences/hooks";
import { useWaiterPublicCard } from "@/features/reviews/hooks";
import { useWaiterProfile } from "@/features/waiterProfile/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useOwnerPeople } from "@/features/staff/hooks";
import { useToast } from "@/providers/Toast";

export default function WaiterProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  // `id` è l'account (`profiles.id`): serve alle rotte pubbliche del
  // professionista (scheda, recensioni, esperienze). La chat invece si apre
  // sulla sua **appartenenza** in questa azienda (`open_conversation` vuole
  // `p_member`): si ricava dall'organico, già in cache dalla tab Staff.
  const { id } = useLocalSearchParams<{ id: string }>();
  const { workspaceId } = useOwnerVenues();
  const people = useOwnerPeople(workspaceId).data ?? [];
  const memberId = people.find((p) => p.waiter_id === id)?.id;
  const startConversation = useStartConversation();

  function onMessage() {
    if (!memberId) return;
    startConversation.mutate(
      { memberId },
      {
        onSuccess: (conv) => router.push(`/(manager)/chat/${conv.id}`),
        onError: () => toast.show("Impossibile aprire la chat. Riprova.", "error"),
      }
    );
  }

  const card = useWaiterPublicCard(id).data;
  const profile = useWaiterProfile(id).data;
  const wp = profile?.waiter_profile ?? null;
  const experiences = useExperiences(id).data ?? [];

  const name = card?.full_name ?? profile?.full_name ?? "Cameriere";
  const roleCity = [card?.primary_role, card?.city].filter(Boolean).join(" · ");

  const headerTop = (
    <View className="gap-3 rounded-3xl border border-border-2 bg-bg-card p-5">
      <View className="flex-row items-center gap-3">
        <Avatar uri={card?.avatar_url ?? undefined} name={name} size={56} />
        <View className="flex-1">
          <Text className="text-lg font-sans-bold text-t1">{name}</Text>
          {roleCity ? <Text className="text-sm text-t3">{roleCity}</Text> : null}
          {REVIEWS_ENABLED ? (
            <RatingBadge
              avg={card?.rating_avg ?? null}
              count={card?.rating_count ?? null}
              className="mt-1"
            />
          ) : null}
        </View>
      </View>
      {profile?.bio ? (
        <Text className="text-sm text-t2">{profile.bio}</Text>
      ) : null}
      {wp?.specializations ? (
        <Text className="text-sm text-t3">
          Specializzazioni: {wp.specializations}
        </Text>
      ) : null}
      {wp?.languages && wp.languages.length > 0 ? (
        <Text className="text-sm text-t3">Lingue: {wp.languages.join(" · ")}</Text>
      ) : null}
      {experiences.length > 0 ? (
        <View className="mt-1 gap-3 border-t border-border pt-4">
          <Mono>Esperienze</Mono>
          <ExperienceTimeline items={experiences} />
        </View>
      ) : null}
      <GhostButton
        className="mt-1"
        label={startConversation.isPending ? "Apertura chat…" : "Invia messaggio"}
        disabled={startConversation.isPending || !memberId}
        onPress={onMessage}
      />
    </View>
  );

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-5 pb-2">
        <ScreenHeader eyebrow="Professionista" title={name} titleClassName="text-2xl" />
      </View>
      {/* Con le recensioni spente resta la scheda: chi è, cosa sa fare, com'è
          raggiungibile. È la metà che serve comunque a chi ha questa persona
          in organico. */}
      {REVIEWS_ENABLED ? (
        <WaiterReviewsList
          waiterId={id}
          headerTop={headerTop}
          bottomInset={insets.bottom + 24}
        />
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: insets.bottom + 24,
          }}
        >
          {headerTop}
        </ScrollView>
      )}
    </View>
  );
}
