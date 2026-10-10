import { useState } from "react";
import { Alert, Linking, Platform } from "react-native";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/ui/Card";
import { CardRow } from "@/components/ui/CardRow";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { cn } from "@/lib/cn";
import { Pressable, ScrollView, Text, View } from "@/tw";
import {
  SUPPORT_EMAIL,
  SUPPORT_PENDING_NOTE,
  SUPPORT_SCOPE_NOTE,
  faqFor,
  supportMailto,
  type SupportFaq,
  type SupportMailContext,
} from "./supportContent";

export type SupportGuide = {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
};

/**
 * «Aiuto e supporto», la stessa per i due lati: cambiano le guide (ognuno vede
 * solo quelle di ciò che può fare) e le domande. I testi stanno in
 * `supportContent.ts`, condivisi con la dashboard.
 */
export function SupportView({
  audience,
  guides,
  workspace,
}: {
  audience: "waiter" | "manager";
  guides: SupportGuide[];
  workspace?: SupportMailContext["workspace"];
}) {
  const insets = useSafeAreaInsets();
  const faq = faqFor(audience);

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-5 pb-2">
        <ScreenHeader eyebrow="Account" title="Aiuto e supporto" />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: insets.bottom + 24,
          gap: 24,
        }}
      >
        {guides.length > 0 ? (
          <View className="gap-2">
            <SectionHeader title="Guide" />
            <Card className="p-0">
              {guides.map((guide, i) => (
                <CardRow key={guide.title} {...guide} divider={i > 0} />
              ))}
            </Card>
          </View>
        ) : null}

        <View className="gap-2">
          <SectionHeader title="Domande frequenti" />
          <Card className="p-0">
            {faq.map((item, i) => (
              <FaqRow key={item.q} item={item} divider={i > 0} />
            ))}
          </Card>
        </View>

        <View className="gap-2">
          <SectionHeader title="Contattaci" />
          <Card className="gap-4">
            <Text className="text-[14px] leading-5 text-t2">
              {SUPPORT_SCOPE_NOTE}
            </Text>
            <ContactAction workspace={workspace} />
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

function FaqRow({ item, divider }: { item: SupportFaq; divider: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      onPress={() => setOpen((v) => !v)}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      className={cn("px-4 py-3.5", divider && "border-t border-border-1")}
    >
      <View className="flex-row items-center gap-3">
        <Text className="flex-1 text-[15px] font-sans-semibold text-t1">
          {item.q}
        </Text>
        <Icon
          name="chevR"
          size={18}
          color="#6A6358"
          style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}
        />
      </View>
      {open ? (
        <Text className="mt-2 text-[14px] leading-5 text-t2">{item.a}</Text>
      ) : null}
    </Pressable>
  );
}

function ContactAction({
  workspace,
}: {
  workspace?: SupportMailContext["workspace"];
}) {
  if (!SUPPORT_EMAIL) {
    return <Text className="text-[13px] text-t3">{SUPPORT_PENDING_NOTE}</Text>;
  }
  const email = SUPPORT_EMAIL;

  const onPress = async () => {
    const os = Platform.OS === "ios" ? "iOS" : Platform.OS === "android" ? "Android" : Platform.OS;
    const version = Constants.expoConfig?.version;
    const url = supportMailto(email, {
      surface: `App ${os}${version ? ` ${version}` : ""}`,
      workspace,
    });
    try {
      await Linking.openURL(url);
    } catch {
      // Nessuna app di posta configurata: l'indirizzo, almeno, lo legge.
      Alert.alert("Scrivici", `Scrivi a ${email}`);
    }
  };

  return (
    <View className="gap-2">
      <GoldButton label="Scrivici" onPress={onPress} />
      <Text className="text-center text-[13px] text-t3">{email}</Text>
    </View>
  );
}
