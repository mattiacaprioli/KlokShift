import type { ReactNode } from "react";
import { useRouter } from "expo-router";
import { Pressable, View } from "@/tw";
import { cn } from "@/lib/cn";
import { Display } from "./Display";
import { Icon } from "./Icon";
import { Mono } from "./Mono";

type Props = {
  /** Mono uppercase eyebrow (e.g. "3 turni" or "Profilo"). */
  eyebrow: string;
  title: string;
  goldEyebrow?: boolean;
  /** Leading button glyph: chevron back (default) or an X close. */
  icon?: "back" | "close";
  /** Optional trailing slot (e.g. a Salva button). */
  right?: ReactNode;
  /** Override the title size (default text-3xl). */
  titleClassName?: string;
  /** Defaults to router.back(). */
  onBack?: () => void;
};

/**
 * In-body screen header with the prototype's circular leading button + serif title.
 * Use on pushed screens with the native Stack header hidden (headerShown:false).
 * Keep it outside ScrollView/FlatList so the header stays fixed while content scrolls.
 */
export function ScreenHeader({
  eyebrow,
  title,
  goldEyebrow,
  icon = "back",
  right,
  titleClassName,
  onBack,
}: Props) {
  const router = useRouter();
  return (
    <View className="flex-row items-center gap-3.5">
      <Pressable
        onPress={onBack ?? (() => router.back())}
        hitSlop={8}
        className="h-12 w-12 items-center justify-center rounded-full border border-border-2 bg-bg-2"
      >
        <Icon name={icon === "close" ? "close" : "chevL"} size={22} color="#F8F4ED" />
      </Pressable>
      <View className="flex-1">
        <Mono gold={goldEyebrow}>{eyebrow}</Mono>
        <Display className={cn("mt-1 text-3xl", titleClassName)}>{title}</Display>
      </View>
      {right}
    </View>
  );
}
