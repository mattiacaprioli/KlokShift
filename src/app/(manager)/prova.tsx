import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, View } from "@/tw";
import { Display } from "@/components/ui/Display";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useStartWorkspaceTrial } from "@/features/workspace/hooks";
import { TRIAL_COPY } from "@/features/workspace/trialCopy";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";

/**
 * L'ultimo passo del setup: avviare la prova di 30 giorni.
 *
 * Ci si arriva subito dopo la prima sede, dalla checklist della Home e dalla
 * card «Stato dell'azienda». La prova parte solo col tocco su «Avvia la prova»
 * (docs/MONETIZATION.md §3, attivazione esplicita): questa schermata è la
 * conferma. «Più tardi» non perde niente, la Home la ripropone.
 *
 * ⚠️ App nativa: niente prezzi né acquisti (TRIAL_COPY è scritto per questo).
 */
export default function TrialScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { workspaceId, access, accessPending, isOwner } = useOwnerVenues();
  const trial = useStartWorkspaceTrial();

  const home = () => router.replace("/(manager)/(tabs)");
  const alreadyActive = !accessPending && !!access && access.state !== "setup";
  const canStart =
    !!workspaceId && isOwner && access?.state === "setup" && (access.usage?.venues ?? 0) > 0;

  const start = async () => {
    if (!workspaceId || trial.isPending) return;
    try {
      await trial.mutateAsync(workspaceId);
      toast.show(TRIAL_COPY.started);
      home();
    } catch {
      // L'errore resta sotto il bottone (trial.error).
    }
  };

  return (
    <View
      className="flex-1 bg-bg-0"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }}
    >
      <ScrollView contentContainerClassName="flex-grow px-6 pb-6">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-gold/15">
          <Icon name="sparkle" size={28} color="#EAB54C" />
        </View>
        <Mono gold className="mt-6">
          {TRIAL_COPY.eyebrow}
        </Mono>
        <Display className="mt-2 text-[30px]">{TRIAL_COPY.title}</Display>
        <Text className="mt-3 font-sans text-[14.5px] leading-6 text-t2">
          {alreadyActive ? TRIAL_COPY.alreadyActive : TRIAL_COPY.lead}
        </Text>

        {!alreadyActive ? (
          <View className="mt-7 gap-3.5 rounded-3xl border border-border-2 bg-bg-card p-5">
            {TRIAL_COPY.points.map((point) => (
              <View key={point} className="flex-row gap-3">
                <Icon name="check" size={18} color="#EAB54C" />
                <Text className="flex-1 font-sans text-[14px] leading-5 text-t1">
                  {point}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {trial.error ? (
          <Text className="mt-4 text-sm text-error">{userErrorMessage(trial.error)}</Text>
        ) : null}
        {!alreadyActive && !accessPending && !canStart ? (
          <Text className="mt-4 text-sm text-t3">
            {isOwner
              ? "Per avviare la prova serve una sede aperta."
              : "La prova la avvia il titolare dell'azienda."}
          </Text>
        ) : null}
      </ScrollView>

      <View className="gap-3 px-6">
        {alreadyActive ? (
          <GoldButton size="lg" label="Vai alla Home" onPress={home} />
        ) : (
          <>
            <GoldButton
              size="lg"
              label={trial.isPending ? TRIAL_COPY.pending : TRIAL_COPY.cta}
              disabled={!canStart || trial.isPending}
              onPress={() => void start()}
            />
            <GhostButton label={TRIAL_COPY.later} disabled={trial.isPending} onPress={home} />
            <Text className="text-center text-xs text-t4">{TRIAL_COPY.laterNote}</Text>
          </>
        )}
      </View>
    </View>
  );
}
