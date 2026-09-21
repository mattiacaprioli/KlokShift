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
import { PermissionSwitches } from "@/features/team/PermissionSwitches";
import {
  NO_PERMISSIONS,
  type TeamPermission,
  type TeamPermissions,
} from "@/features/team/api";
import { userErrorMessage } from "@/lib/errors";

/**
 * Invita un collaboratore.
 *
 * Nome, email, permessi, sedi — in quest'ordine, che è quello in cui il titolare
 * pensa: *chi* faccio entrare, *cosa* può fare e *dove*. Non gli si chiede se
 * quella persona abbia già KlokShift: è `addTeamMember` a deciderlo, come per
 * l'organico.
 */
export default function TeamNewScreen() {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { workspaceId, venues, isMultiVenue } = useOwnerVenues();

  const add = useAddTeamMember();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  /** Vuoto = tutte le sedi, anche quelle future. */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Si parte tutto spento: un permesso già acceso è una scelta fatta al posto
  // del titolare, e passa inosservata proprio perché non l'ha fatta lui.
  const [permissions, setPermissions] =
    useState<TeamPermissions>(NO_PERMISSIONS);
  const noPermissions = !Object.values(permissions).some(Boolean);

  // Con una sede sola la domanda non si pone: è quella, e l'ambito resta
  // «tutte» — così una sede aperta domani non lo lascia fuori.
  const allVenues = !isMultiVenue || picked.size === 0;

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
    if (!workspaceId || !fullName.trim() || !email.trim() || noPermissions)
      return;
    add.mutate(
      {
        workspaceId,
        fullName: fullName.trim(),
        email: email.trim(),
        permissions,
        scope: allVenues ? "all" : "selected",
        venueIds: [...picked],
      },
      {
        onSuccess: (res) => {
          if (res.kind === "already") {
            toast.show("Collabora già alla gestione.", "error");
            return;
          }
          toast.show(
            res.kind === "invited_in_app"
              ? "Invito mandato: lo accetta dall'app"
              : res.emailSent
                ? "Invito spedito"
                : res.emailError
                  ? `Invito creato · email non spedita: ${res.emailError}`
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
        <NoVenuesState subtitle="Ti serve una sede prima di far entrare qualcuno." />
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
          <Input
            label="Nome e cognome"
            value={fullName}
            onChangeText={setFullName}
            placeholder="Come lo chiami tu"
          />

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
              Se ha già un account, trova l&apos;invito da accettare quando
              entra. Altrimenti gli mandiamo un link: lo apre, sceglie una
              password ed è dentro, senza registrarsi. Finché non lo apre non
              esiste nessun account.
            </Text>
          </View>

          <View className="gap-2">
            <Mono>Cosa può fare</Mono>
            <PermissionSwitches value={permissions} onChange={setPerm} />
            <Text className="px-1 text-[12px] leading-4 text-t4">
              Restano tuoi: aprire e chiudere sedi, invitare altri collaboratori
              e l&apos;account. I permessi si cambiano dopo, dalla sua scheda.
            </Text>
          </View>

          {isMultiVenue ? (
            <View className="gap-2">
              <Mono>Dove</Mono>
              <View className="flex-row flex-wrap gap-2">
                {venues.map((v) => (
                  <Chip
                    key={v.id}
                    label={v.name}
                    gold
                    active={picked.has(v.id)}
                    onPress={() => toggleVenue(v.id)}
                  />
                ))}
              </View>
              <Text className="px-1 text-[12px] leading-4 text-t4">
                {allVenues
                  ? "Nessuna scelta: vale su tutte le sedi, anche quelle che aprirai."
                  : "Vale solo sulle sedi scelte."}
              </Text>
            </View>
          ) : null}

          <GoldButton
            className="mt-1"
            label={add.isPending ? "Invio…" : "Invita"}
            disabled={
              add.isPending ||
              !fullName.trim() ||
              !email.trim() ||
              noPermissions
            }
            onPress={submit}
          />
          {noPermissions ? (
            <Text className="text-center text-[12px] text-t4">
              Scegli almeno un permesso.
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
