import { useEffect, type PropsWithChildren } from "react";
import {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { View } from "@/tw";
import { Animated } from "@/tw/animated";
import { cn } from "@/lib/cn";

/** Le forme sono statiche: una sola animazione per regione di caricamento. */
export function Skeleton({ className }: { className?: string }) {
  return <View className={cn("h-3 rounded-md bg-bg-3", className)} />;
}

export function SkeletonGroup({
  children,
  label = "Caricamento…",
  className,
}: PropsWithChildren<{ label?: string; className?: string }>) {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (!reducedMotion) {
      opacity.value = withRepeat(
        withTiming(0.55, {
          duration: 850,
          easing: Easing.inOut(Easing.ease),
          reduceMotion: ReduceMotion.System,
        }),
        -1,
        true,
        undefined,
        ReduceMotion.System,
      );
    }
    return () => cancelAnimation(opacity);
  }, [opacity, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      accessibilityLiveRegion="polite"
      className={className}
    >
      <Animated.View
        style={animatedStyle}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {children}
      </Animated.View>
    </View>
  );
}

export function ListSkeleton({
  rows = 3,
  variant = "shift",
  label,
  className,
}: {
  rows?: number;
  variant?: "shift" | "person";
  label?: string;
  className?: string;
}) {
  return (
    <SkeletonGroup label={label} className={className}>
      <View className="gap-3">
        {Array.from({ length: rows }, (_, i) => (
          <View key={i} className="rounded-3xl border border-border-2 bg-bg-card p-4">
            <View className="flex-row items-center gap-3">
              {variant === "person" ? <Skeleton className="h-10 w-10 rounded-full" /> : null}
              <View className="flex-1 gap-2">
                <Skeleton className={i % 2 ? "h-4 w-2/3" : "h-4 w-1/2"} />
                <Skeleton className="w-3/4" />
              </View>
              <Skeleton className="h-5 w-14 rounded-full" />
            </View>
            {variant === "shift" ? (
              <View className="mt-4 flex-row items-center gap-3">
                <Skeleton className="h-6 w-28" />
                <Skeleton className="w-16" />
              </View>
            ) : null}
          </View>
        ))}
      </View>
    </SkeletonGroup>
  );
}

export function NextShiftSkeleton() {
  return (
    <SkeletonGroup label="Caricamento del tuo prossimo turno…">
      <View className="rounded-3xl border border-border-2 bg-bg-card p-5">
        <Skeleton className="w-28" />
        <Skeleton className="mt-3 h-8 w-3/4" />
        <Skeleton className="mt-3 h-4 w-1/2" />
        <Skeleton className="mt-2 w-2/3" />
        <Skeleton className="mt-5 h-10 w-full rounded-full bg-bg-2" />
      </View>
    </SkeletonGroup>
  );
}

export function HomeSkeleton() {
  return (
    <View className="gap-6">
      <SkeletonGroup label="Caricamento riepilogo…">
        <Skeleton className="mb-3 w-28" />
        <View className="flex-row gap-2.5">
          {[0, 1].map((i) => (
            <View key={i} className="flex-1 rounded-3xl border border-border-2 bg-bg-card px-4 py-3.5">
              <Skeleton className="h-8 w-12" />
              <Skeleton className="mt-2 h-4 w-3/4" />
              <Skeleton className="mt-2 w-2/3" />
            </View>
          ))}
        </View>
      </SkeletonGroup>
      <ListSkeleton variant="person" label="Caricamento di chi lavora oggi…" />
      <ListSkeleton label="Caricamento prossimi turni…" />
    </View>
  );
}

export function WeekSkeleton({ className }: { className?: string }) {
  return (
    <SkeletonGroup label="Caricamento turni della settimana…" className={className}>
      <View className="flex-row overflow-hidden rounded-2xl border border-border-2 bg-bg-card">
        {Array.from({ length: 7 }, (_, i) => (
          <View key={i} className="min-h-72 flex-1 gap-6 border-r border-border p-1.5">
            <Skeleton className="h-4 w-full" />
            {i % 3 !== 2 ? <Skeleton className="h-20 w-full rounded-lg bg-bg-2" /> : null}
            {i % 2 === 0 ? <Skeleton className="h-16 w-full rounded-lg bg-bg-2" /> : null}
          </View>
        ))}
      </View>
    </SkeletonGroup>
  );
}

export function ConversationListSkeleton() {
  return (
    <SkeletonGroup label="Caricamento conversazioni…" className="px-5 pt-2">
      <View className="gap-3">
        {Array.from({ length: 5 }, (_, i) => (
          <View key={i} className="flex-row items-center gap-3 rounded-3xl border border-border-2 bg-bg-card p-4">
            <Skeleton className="h-12 w-12 rounded-full" />
            <View className="flex-1 gap-2">
              <Skeleton className={i % 2 ? "h-4 w-2/3" : "h-4 w-1/2"} />
              <Skeleton className="h-3.5 w-5/6" />
            </View>
            <View className="items-end gap-2">
              <Skeleton className="h-2.5 w-8" />
              <Skeleton className="h-4 w-4 rounded-full" />
            </View>
          </View>
        ))}
      </View>
    </SkeletonGroup>
  );
}

export function ChatHeaderSkeleton() {
  return (
    <SkeletonGroup label="Caricamento contatto…" className="flex-1">
      <View className="flex-row items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <View className="flex-1 gap-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="w-1/2" />
        </View>
      </View>
    </SkeletonGroup>
  );
}

export function MessageSkeleton() {
  return (
    <View className="flex-1 justify-end overflow-hidden px-4 py-3">
      <SkeletonGroup label="Caricamento messaggi…">
        <View className="gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <View
              key={i}
              className={cn(
                "gap-2 rounded-2xl bg-bg-2 px-3.5 py-2.5",
                i % 2 ? "w-3/5 self-end rounded-br-md" : "w-4/5 self-start rounded-bl-md",
              )}
            >
              <Skeleton className="w-full" />
              {i % 3 === 0 ? <Skeleton className="w-2/3" /> : null}
              <Skeleton className="h-2 w-8 self-end" />
            </View>
          ))}
        </View>
      </SkeletonGroup>
    </View>
  );
}
