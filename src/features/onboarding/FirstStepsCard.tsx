import { useEffect, useState } from "react";
import { useRouter, type Href } from "expo-router";
import { Pressable, Text, View } from "@/tw";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { cn } from "@/lib/cn";
import type { FirstStep, FirstStepId, FirstStepsMemory } from "./firstSteps";
import { loadFirstStepsMemory, saveFirstStepsMemory } from "./firstStepsStorage";
import { useFirstSteps } from "./useFirstSteps";

const ROUTES: Record<FirstStepId, Href> = {
  trial: "/(manager)/prova",
  roles: "/(manager)/ruoli",
  people: "/(manager)/staff/new",
  shift: "/(manager)/shift/new",
  team: "/(manager)/(tabs)/staff",
};

/**
 * «Primi passi» in testa alla Home del titolare: cosa manca perché l'azienda
 * giri, nell'ordine in cui si può fare, con il bottone sul prossimo passo.
 * I passi si spuntano da soli (`computeFirstSteps`). Sparisce a lavoro finito,
 * o quando la si chiude — e la chiusura c'è solo a prova avviata.
 */
export function FirstStepsCard() {
  const router = useRouter();
  /** `undefined` finché lo storage non ha risposto. */
  const [memory, setMemory] = useState<FirstStepsMemory | null | undefined>(undefined);
  const steps = useFirstSteps(memory === null);
  const { userId, workspaceId } = steps;

  useEffect(() => {
    if (!userId || !workspaceId) return;
    let alive = true;
    void loadFirstStepsMemory(userId, workspaceId).then((value) => {
      if (alive) setMemory(value);
    });
    return () => {
      alive = false;
    };
  }, [userId, workspaceId]);

  const finished = memory === null && steps.visible && steps.ready && steps.allDone;
  useEffect(() => {
    if (!finished || !userId || !workspaceId) return;
    void saveFirstStepsMemory(userId, workspaceId, "completed");
  }, [finished, userId, workspaceId]);

  if (memory !== null || !steps.visible || !steps.ready || steps.allDone) return null;

  const dismiss = () => {
    setMemory("dismissed");
    if (userId && workspaceId) void saveFirstStepsMemory(userId, workspaceId, "dismissed");
  };

  return (
    <View className="gap-4 rounded-3xl border border-border-gold bg-bg-card p-5">
      <View className="flex-row items-start gap-3">
        <View className="flex-1">
          <Mono gold>
            Primi passi · {steps.doneCount} di {steps.steps.length}
          </Mono>
          <Text className="mt-1 font-sans-bold text-lg text-t1">
            Prepara la tua azienda
          </Text>
        </View>
        {steps.canDismiss ? (
          <Pressable
            onPress={dismiss}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Nascondi i primi passi"
          >
            <Icon name="close" size={18} color="#8c857a" />
          </Pressable>
        ) : null}
      </View>
      <ProgressBar progress={steps.doneCount / steps.steps.length} />

      <View className="gap-1">
        {steps.steps.map((step, i) => (
          <StepRow
            key={step.id}
            step={step}
            index={i}
            isNext={steps.next?.id === step.id}
            onPress={() => router.push(ROUTES[step.id])}
          />
        ))}
      </View>

      {steps.next ? (
        <View className="gap-2">
          <GoldButton
            label={steps.next.cta}
            onPress={() => router.push(ROUTES[steps.next!.id])}
          />
          {steps.next.id === "people" && !steps.hasSelfCard ? (
            <GhostButton
              label="Lavori anche tu? Mettiti nel team"
              onPress={() => router.push("/(manager)/staff/new?self=1")}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function StepRow({
  step,
  index,
  isNext,
  onPress,
}: {
  step: FirstStep;
  index: number;
  isNext: boolean;
  onPress: () => void;
}) {
  const done = step.status === "done";
  const locked = step.status === "locked";
  return (
    <Pressable
      onPress={onPress}
      disabled={locked}
      accessibilityRole="button"
      accessibilityState={{ disabled: locked, checked: done }}
      className={cn("flex-row gap-3 rounded-2xl px-2 py-2.5", isNext && "bg-bg-2")}
    >
      <View
        className={cn(
          "h-7 w-7 items-center justify-center rounded-full border",
          done ? "border-gold bg-gold" : "border-border-2 bg-bg-1"
        )}
      >
        {done ? (
          <Icon name="check" size={14} color="#1A1206" />
        ) : locked ? (
          <Icon name="lock" size={12} color="#6a6358" />
        ) : (
          <Text className="text-xs font-sans-bold text-t2">{index + 1}</Text>
        )}
      </View>
      <View className="flex-1">
        <Text
          className={cn(
            "text-[15px] font-sans-semibold",
            done ? "text-t3 line-through" : locked ? "text-t3" : "text-t1"
          )}
        >
          {step.title}
        </Text>
        {isNext ? (
          <Text className="mt-0.5 text-[13px] leading-[18px] text-t3">
            {step.detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
