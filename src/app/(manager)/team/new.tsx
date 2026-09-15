import { useState } from "react";
import { useRouter } from "expo-router";
import { KeyboardAvoidingView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, View } from "@/tw";
import { Chip } from "@/components/ui/Chip";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/ui/Mono";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useToast } from "@/providers/Toast";
import { NoVenuesState } from "@/features/venues/NoVenuesState";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useAddTeamMember } from "@/features/team/hooks";
import {
  DEFAULT_TEAM_PERMISSIONS,
  PermissionSwitches,
} from "@/features/team/PermissionSwitches";
import type { TeamPermission, TeamPermissions } from "@/features/team/api";
import { userErrorMessage } from "@/lib/errors";

/**
 * Invita un collaboratore.
 *
 * Email, sedi, permessi — in quest'ordine, che è quello in cui il titolare
 * pensa: *chi* faccio entrare, *dove*, e *cosa* può fare. Non gli si chiede se
 * quella persona abbia già topWaitr: è `addTeamMember` a deciderlo, come per
 * l'organico.
 */
export default function TeamNewScreen() {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { ownerId, venues, isMultiVenue } = useOwnerVenues();

  const add = useAddTeamMember();

  const [email, setEmail] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [permissions, setPermissions] = useState<TeamPermissions>(
    DEFAULT_TEAM_PERMISSIONS
  );

  // Con una sede sola la domanda non si pone: è quella.
  const venueIds = isMultiVenue ? picked : new Set(venues.map((v) => v.id));

  function toggleVenue(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setPerm(perm: TeamPermission, next: boolean) {
    setPermissions((prev) => ({ ...prev, [perm]: next }));
  }

  function submit() {
    if (!ownerId || !email.trim() || venueIds.size === 0) return;
    add.mutate(
      {
        ownerId,
        email: email.trim(),
        venueIds: [...venueIds],
        permissions,
      },
      {
        onSuccess: (res) => {
          if (res.kind === "already") {
            toast.show("Ha già accesso a queste sedi.", "error");
            return;
          }
          toast.show(
            res.kind === "linked"
              ? `${res.name ?? "Il collaboratore"} ora ha accesso`
              : res.emailSent
                ? "Invito spedito"
                : "Invito creato · email non spedita, riprova dalla lista"
          );
          router.back();
        },
        onError: (e) => toast.show(userErrorMessage(e), "error"),
      }
    );
  }

  if (venues.length === 0) {
    return (
      <View
        className="flex-1 bg-bg-0 px-5"
        style={{ paddingTop: insets.top + 8 }}
      >
        <ScreenHeader eyebrow="Collaboratori" title="Invita" />
        <NoVenuesState subtitle="Ti serve un locale prima di far entrare qualcuno." />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView
        className="flex-1 bg-bg-0"
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 48,
          gap: 20,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader eyebrow="Collaboratori" title="Invita" />

        <View className="gap-5">
          <View className="gap-2">
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="nome@email.com"
            />
            <Text className="text-xs leading-4 text-t3">
              Se ha già un account da locale, l&apos;accesso parte subito.
              Altrimenti gli mandiamo un invito: si registrerà con questa email
              scegliendo «Gestisco un locale» e lo colleghiamo da soli.
            </Text>
          </View>

          {isMultiVenue ? (
            <View className="gap-2">
              <Mono>Su quali sedi</Mono>
              <View className="flex-row flex-wrap gap-2">
                {venues.map((v) => (
                  <Chip
                    key={v.id}
                    label={v.name}
                    gold
                    active={venueIds.has(v.id)}
                    onPress={() => toggleVenue(v.id)}
                  />
                ))}
              </View>
            </View>
          ) : null}

          <View className="gap-2">
            <Mono>Cosa può fare</Mono>
            <PermissionSwitches value={permissions} onChange={setPerm} />
            <Text className="px-1 text-[12px] leading-4 text-t4">
              Restano tuoi: aprire e chiudere sedi, invitare altri collaboratori
              e l&apos;account. I permessi valgono su tutte le sedi scelte qui e
              si cambiano dopo, sede per sede.
            </Text>
          </View>

          <GoldButton
            className="mt-1"
            label={add.isPending ? "Invio…" : "Invita"}
            disabled={add.isPending || !email.trim() || venueIds.size === 0}
            onPress={submit}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
