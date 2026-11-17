import { CountBadge } from "@/components/ui/CountBadge";
import { Icon, type IconName } from "@/components/ui/Icon";
import { withAlpha } from "@/constants/colors";
import { FontFamily } from "@/constants/fonts";
import { Pressable, Text, View } from "@/tw";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { useColors } from "@/lib/theme";

export type TabBarProps = Parameters<
  NonNullable<ComponentProps<typeof Tabs>["tabBar"]>
>[0];

/**
 * Floating, rounded pill tab bar — full control over spacing/centering.
 * Shared across roles; pass an `icons` map (route name → IconName) and,
 * opzionalmente, `badges` (route name → conteggio non letti).
 */
export function FloatingTabBar({
  state,
  descriptors,
  navigation,
  insets,
  icons,
  badges,
}: TabBarProps & {
  icons: Record<string, IconName>;
  badges?: Record<string, number>;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        position: "absolute",
        left: 10,
        right: 10,
        bottom: insets.bottom > 0 ? insets.bottom : 16,
        height: 64,
        flexDirection: "row",
        borderRadius: 20,
        borderCurve: "continuous",
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: withAlpha(colors.wash, 0.08),
        boxShadow: `0 12px 30px ${withAlpha(colors.scrim, 0.5)}`,
      }}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const focused = state.index === index;
        const label = (options.title ?? route.name) as string;
        const iconName = icons[route.name] ?? "home";
        const badge = badges?.[route.name] ?? 0;

        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
            }}
          >
            <View>
              <Icon name={iconName} size={22} color={focused ? colors.gold : colors.t3} />
              <CountBadge count={badge} className="absolute -right-2.5 -top-1.5" />
            </View>
            <Text
              numberOfLines={1}
              style={{
                color: focused ? colors.gold : colors.t3,
                // Come sito e dashboard: niente maiuscolo spaziato (15/11).
                fontFamily: focused ? FontFamily.sansSemibold : FontFamily.sansMedium,
                fontSize: 11,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
