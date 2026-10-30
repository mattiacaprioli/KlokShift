import { useEffect, useState } from "react";
import { useRouter, type Href } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { Mono } from "@/components/ui/Mono";
import { Text, View } from "@/tw";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import type { TeamPermission } from "@/features/workspace/permissions";
import { collaboratorSummary } from "./collaboratorSummary";

/** Dove porta ciascun permesso nell'app (la dashboard ha i suoi percorsi). */
const APP_START: Record<TeamPermission, { href: Href; label: string }> = {
  can_manage_shifts: { href: "/(manager)/(tabs)/turni", label: "Apri i turni" },
  can_manage_staff: { href: "/(manager)/(tabs)/staff", label: "Apri il team" },
  can_view_hours: { href: "/(manager)/ore", label: "Apri le ore" },
  can_manage_documents: { href: "/(manager)/(tabs)/staff", label: "Apri il team" },
  can_manage_venue: { href: "/(manager)/(tabs)/profilo", label: "Apri la sede" },
};

const welcomeKey = (memberId: string) => `collab-welcome.${memberId}`;

/**
 * Cosa può fare il collaboratore, su quali sedi e cosa resta al titolare —
 * quello che la dashboard dice in `CollaboratorWelcome`, anche nell'app.
 *
 * - `welcome`: in Home finché non lo chiude (per appartenenza, su questo
 *   telefono), con il bottone da cui cominciare.
 * - `settings`: sempre, in Impostazioni, per ritrovarlo dopo averlo chiuso.
 *
 * Solo per chi è collaboratore nell'azienda aperta; per gli altri non c'è.
 */
export function CollaboratorPermissionsCard({
  variant,
}: {
  variant: "welcome" | "settings";
}) {
  const router = useRouter();
  const { authority, workspaceId, memberships } = useOwnerVenues();
  const membership = memberships.find((m) => m.workspace_id === workspaceId);
  const memberId = membership?.member_id;
  /** `undefined` finché lo storage non ha risposto: niente lampo in Home. */
  const [seen, setSeen] = useState<boolean | undefined>(
    variant === "settings" ? false : undefined
  );

  useEffect(() => {
    if (variant !== "welcome" || !memberId) return;
    let alive = true;
    SecureStore.getItemAsync(welcomeKey(memberId))
      .then((value) => alive && setSeen(value === "1"))
      .catch(() => alive && setSeen(false));
    return () => {
      alive = false;
    };
  }, [variant, memberId]);

  if (authority !== "collaborator" || !membership || seen !== false) return null;
  const s = collaboratorSummary(membership);
  const first = s.can[0];
  const start = first ? APP_START[first.perm] : null;

  const close = () => {
    setSeen(true);
    SecureStore.setItemAsync(welcomeKey(membership.member_id), "1").catch(() => {
      // Non ricordarlo costa un benvenuto in più.
    });
  };

  return (
    <View className="gap-4 rounded-3xl border border-border-gold bg-bg-card p-5">
      <View>
        <Mono gold>{variant === "welcome" ? "Benvenuto" : "I tuoi permessi"}</Mono>
        <Text className="mt-1 font-sans-bold text-lg text-t1">
          Collabori con {s.workspaceName}
        </Text>
      </View>

      <View className="gap-2">
        <Mono>Cosa puoi fare</Mono>
        {s.can.length > 0 ? (
          s.can.map((c) => (
            <View key={c.perm}>
              <Text className="text-[15px] font-sans-semibold text-t1">{c.label}</Text>
              <Text className="text-[13px] text-t3">{c.hint}</Text>
            </View>
          ))
        ) : (
          <Text className="text-sm text-t2">
            Per ora puoi solo consultare. I permessi li dà il titolare.
          </Text>
        )}
      </View>

      {s.cannot.length > 0 && s.can.length > 0 ? (
        <View className="gap-1">
          <Mono>Non hai</Mono>
          <Text className="text-sm text-t2">
            {s.cannot.join(", ")}: se ti servono, chiedili al titolare.
          </Text>
        </View>
      ) : null}

      <View className="gap-1">
        <Mono>Dove</Mono>
        <Text className="text-sm text-t2">{s.venues}</Text>
      </View>

      <Text className="text-[13px] leading-5 text-t3">{s.ownerKeeps}</Text>

      {variant === "welcome" ? (
        <View className="gap-2">
          {start ? (
            <GoldButton
              label={start.label}
              onPress={() => {
                close();
                router.push(start.href);
              }}
            />
          ) : null}
          <GhostButton label="Ho capito" onPress={close} />
        </View>
      ) : null}
    </View>
  );
}
