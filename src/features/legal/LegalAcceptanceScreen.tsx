import { Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Display } from "@/components/ui/Display";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { LEGAL_URLS } from "@/features/account/legal";
import { useViewMode } from "@/features/team/ViewMode";
import { useAuth } from "@/lib/auth";
import { userErrorMessage } from "@/lib/errors";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { LEGAL_COPY, legalBody, legalWaiting } from "./copy";
import type { LegalGate } from "./gate";
import { useAcceptLegalTerms } from "./hooks";
import { LegalDocLinks } from "./LegalCheckbox";

/**
 * Il blocco della vista di gestione: al posto di tutto `(manager)` finché un
 * titolare non accetta termini e DPA. Chi lavora anche nei turni può passare
 * alla sua vista: il blocco è sulla gestione, mai sul lavoro.
 */
export function LegalAcceptanceScreen({ gate }: { gate: LegalGate }) {
  const insets = useSafeAreaInsets();
  const { canSwitch, setMode } = useViewMode();
  const accept = useAcceptLegalTerms();

  return (
    <View
      className="flex-1 bg-bg-0"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }}
    >
      <ScrollView contentContainerClassName="flex-grow gap-4 px-6 pb-6">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-gold/15">
          <Icon name="shield" size={28} color="#EAB54C" />
        </View>
        <Display className="text-[28px]">{LEGAL_COPY.title}</Display>

        {gate.toAccept.map((w) => (
          <View key={w.workspaceId} className="gap-3 rounded-3xl border border-border-2 bg-bg-card p-5">
            <Text className="font-sans text-[14.5px] leading-6 text-t1">
              {legalBody(w.workspaceName)}
            </Text>
            <LegalDocLinks />
            <GoldButton
              label={accept.isPending ? LEGAL_COPY.accepting : LEGAL_COPY.accept}
              disabled={accept.isPending}
              onPress={() => accept.mutate(w.workspaceId)}
            />
          </View>
        ))}

        {gate.waiting.map((w) => (
          <View key={w.workspaceId} className="rounded-3xl border border-border-2 bg-bg-card p-5">
            <Text className="font-sans text-[14.5px] leading-6 text-t2">
              {legalWaiting(w.workspaceName)}
            </Text>
          </View>
        ))}

        {accept.error ? (
          <Text className="text-sm text-error">{userErrorMessage(accept.error)}</Text>
        ) : null}
      </ScrollView>

      <View className="gap-3 px-6">
        {canSwitch ? (
          <GhostButton label={LEGAL_COPY.switchToWork} onPress={() => setMode("waiter")} />
        ) : null}
        <LegalExitActions />
      </View>
    </View>
  );
}

/**
 * Le uscite che il blocco non deve mai togliere: con `(manager)` smontato,
 * Menu e Impostazioni non si raggiungono, e chi non accetta (o aspetta un
 * titolare che non entra) deve poter uscire o sapere come eliminare l'account.
 */
export function LegalExitActions() {
  const { signOut } = useAuth();
  return (
    <View className="items-center gap-3">
      <GhostButton label={LEGAL_COPY.signOut} onPress={() => void signOut()} />
      <Pressable onPress={() => Linking.openURL(LEGAL_URLS.accountDeletion)}>
        <Text className="font-sans text-[13px] text-t3 underline">{LEGAL_COPY.deleteAccount}</Text>
      </Pressable>
    </View>
  );
}
