import React from "react";
import { Card } from "./Card";
import { Icon, type IconName } from "./Icon";
import { cn } from "@/lib/cn";
import { Text, View } from "@/tw";

/**
 * Riga che porta altrove: bolla icona, titolo, sottotitolo, chevron.
 *
 * È il pattern più riscritto a mano dell'app — «Le mie ore», «I tuoi
 * documenti», «Copertura turni», «Ruoli della sede» erano lo stesso markup in
 * cinque copie, con quattro misure diverse della bolla. Il `right` serve a chi
 * deve mostrare qualcos'altro al posto della chevron (un lucchetto Pro).
 */
export function NavRow({
  icon,
  title,
  subtitle,
  onPress,
  right,
  className,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={cn("rounded-3xl border-border-2 p-4", className)}
      onPress={onPress}
    >
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full border border-border-2 bg-bg-2">
          <Icon name={icon} size={18} color="#EAB54C" />
        </View>
        <View className="flex-1">
          <Text className="text-base font-sans-bold text-t1" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text className="text-[13px] text-t2" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ?? <Icon name="chevR" size={18} color="#8c857a" />}
      </View>
    </Card>
  );
}
