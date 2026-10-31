import { Linking } from "react-native";
import { Icon } from "@/components/ui/Icon";
import { LEGAL_URLS } from "@/features/account/legal";
import { cn } from "@/lib/cn";
import { Pressable, Text, View } from "@/tw";
import { LEGAL_COPY } from "./copy";

/**
 * La casella dei form che aprono un'azienda: non preselezionata, e senza di
 * lei il pulsante resta spento. È l'accordo ex art. 28 in forma elettronica.
 */
export function LegalCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <View className="gap-2">
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={() => onChange(!checked)}
        className="flex-row items-start gap-3"
      >
        <View
          className={cn(
            "mt-0.5 h-5 w-5 items-center justify-center rounded-md border",
            checked ? "border-gold bg-gold" : "border-border-2 bg-bg-2"
          )}
        >
          {checked ? <Icon name="check" size={14} color="#0C0907" /> : null}
        </View>
        <Text className="flex-1 font-sans text-[13px] leading-5 text-t2">
          {LEGAL_COPY.checkbox}
        </Text>
      </Pressable>
      <LegalDocLinks />
    </View>
  );
}

/** I due testi da leggere prima di accettare, aperti nel browser. */
export function LegalDocLinks() {
  return (
    <View className="flex-row flex-wrap gap-x-4 gap-y-1 pl-8">
      <Pressable onPress={() => Linking.openURL(LEGAL_URLS.terms)}>
        <Text className="font-sans-semibold text-[13px] text-gold">{LEGAL_COPY.terms}</Text>
      </Pressable>
      <Pressable onPress={() => Linking.openURL(LEGAL_URLS.dpa)}>
        <Text className="font-sans-semibold text-[13px] text-gold">{LEGAL_COPY.dpa}</Text>
      </Pressable>
    </View>
  );
}
