import { useState } from "react";
import { useRouter } from "expo-router";
import { RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { Pill } from "@/components/ui/Pill";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useToast } from "@/providers/Toast";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import {
  useRevokeTeamAccess,
  useSendTeamInvite,
  useTeam,
  useUpdateTeamPermissions,
} from "@/features/team/hooks";
import { PermissionSwitches } from "@/features/team/PermissionSwitches";
import {
  permissionsOf,
  TEAM_PERMISSIONS,
  TEAM_PERMISSION_LABEL,
  type TeamMember,
  type TeamPermission,
  type VenueAccess,
} from "@/features/team/api";
import { userErrorMessage } from "@/lib/errors";

/** Le aree accese su una sede, in due parole. "Nessun permesso" se nessuna. */
function permissionSummary(row: VenueAccess): string {
  const on = TEAM_PERMISSIONS.filter((p) => row[p]).map(
    (p) => TEAM_PERMISSION_LABEL[p]
  );
  return on.length > 0 ? on.join(" · ") : "Nessun permesso";
}

/**
 * Una sede del collaboratore: riepilogo, e gli interruttori quando si apre.
 *
 * I permessi si cambiano **per sede** e non per persona: chi gestisce due sedi
 * può avere due mestieri diversi, e un unico interruttore "su tutte le sedi"
 * cancellerebbe la differenza senza dirlo.
 */
function VenueAccessRow({
  row,
  venueName,
  onRevoke,
}: {
  row: VenueAccess;
  venueName: string;
  onRevoke: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const update = useUpdateTeamPermissions();

  function setPerm(perm: TeamPermission, next: boolean) {
    update.mutate(
      { accessId: row.id, permissions: { [perm]: next } },
      { onError: (e) => toast.show(userErrorMessage(e), "error") }
    );
  }

  return (
    <View className="border-t border-border-1 px-4 py-3">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center gap-3"
      >
        <View className="flex-1">
          <Text className="text-[14px] font-sans-semibold text-t1">
            {venueName}
          </Text>
          <Text className="mt-0.5 text-[12px] leading-4 text-t3">
            {permissionSummary(row)}
          </Text>
        </View>
        {/* Niente "chevD" fra le icone: la chevron si ruota, ed è il caso per
            cui `Icon` accetta uno `style`. */}
        <Icon
          name="chevR"
          size={16}
          color="#6A6358"
          style={open ? { transform: [{ rotate: "90deg" }] } : undefined}
        />
      </Pressable>

      {open ? (
        <View className="mt-3 gap-3">
          <PermissionSwitches
            value={permissionsOf(row)}
            onChange={setPerm}
            disabled={update.isPending}
          />
          <GhostButton label={`Togli l'accesso a ${venueName}`} onPress={onRevoke} />
        </View>
      ) : null}
    </View>
  );
}

function MemberCard({
  member,
  venueName,
  onRevokeRow,
  onRevokeAll,
}: {
  member: TeamMember;
  venueName: (id: string) => string;
  onRevokeRow: (row: VenueAccess) => void;
  onRevokeAll: (member: TeamMember) => void;
}) {
  const toast = useToast();
  const invite = useSendTeamInvite();
  const pending = member.status === "pending";
  const title = member.fullName?.trim() || member.email || "Collaboratore";

  return (
    <Card className="gap-0 p-0">
      <View className="flex-row items-center gap-3 px-4 py-3.5">
        <Avatar uri={member.avatarUrl ?? undefined} name={title} size={38} />
        <View className="flex-1">
          <Text className="text-[15px] font-sans-semibold text-t1" numberOfLines={1}>
            {title}
          </Text>
          <Text className="mt-0.5 text-[13px] text-t3" numberOfLines={1}>
            {member.email ?? "Account collegato"}
          </Text>
        </View>
        {pending ? <Pill label="Invito mandato" /> : null}
      </View>

      {pending ? (
        <View className="gap-2 border-t border-border-1 px-4 py-3">
          {/* Due strade, e vanno dette tutt'e due: a chi non aveva un account
              l'abbiamo preparato noi e gli basta aprire il link, chi ce l'ha già
              entra al primo accesso dopo l'invito (`claimInvites` in
              lib/auth.tsx). Nominarne una sola fa sembrare l'invito rotto
              all'altra metà. */}
          <Text className="text-[12px] leading-4 text-t3">
            Entra aprendo il link che gli abbiamo mandato e scegliendo una
            password. Se aveva già un account, gli basta rientrare.
          </Text>
          <GhostButton
            label={invite.isPending ? "Invio…" : "Reinvia l'invito"}
            onPress={() =>
              invite.mutate(member.rows[0].id, {
                onSuccess: () => toast.show("Invito spedito"),
                onError: (e) => toast.show(userErrorMessage(e), "error"),
              })
            }
          />
        </View>
      ) : null}

      {member.rows.map((row) => (
        <VenueAccessRow
          key={row.id}
          row={row}
          venueName={venueName(row.venue_id)}
          onRevoke={() => onRevokeRow(row)}
        />
      ))}

      <View className="border-t border-border-1 px-4 py-3">
        <GhostButton label="Revoca tutto" onPress={() => onRevokeAll(member)} />
      </View>
    </Card>
  );
}

/**
 * I collaboratori del titolare.
 *
 * Il caso che risolve: due persone che organizzano i turni dello stessa sede e
 * finora si passavano le credenziali di un account solo. Da qui ognuna ha il suo
 * accesso, sulle sedi che il titolare sceglie e con i permessi che sceglie.
 *
 * ⚠️ Schermata del **titolare**: un collaboratore non la vede (né la rotta, né la
 * riga in Impostazioni). Non è una difesa — quella è la RLS su `venue_access`,
 * che gli lascia leggere solo le proprie righe.
 */
export default function TeamScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { ownerId, venueById, isOwner } = useOwnerVenues();
  const team = useTeam(isOwner ? (ownerId ?? "") : "");
  const revoke = useRevokeTeamAccess();

  /** Cosa si sta per revocare: una sede sola o tutte. */
  const [confirm, setConfirm] = useState<
    { ids: string[]; title: string; message: string } | null
  >(null);

  const members = team.data ?? [];

  function venueName(id: string): string {
    return venueById(id)?.name ?? "Sede";
  }

  function doRevoke() {
    if (!confirm) return;
    revoke.mutate(confirm.ids, {
      onSuccess: () => {
        toast.show("Accesso revocato");
        setConfirm(null);
      },
      onError: (e) => {
        toast.show(userErrorMessage(e), "error");
        setConfirm(null);
      },
    });
  }

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-5 pb-2">
        <ScreenHeader eyebrow="Account" title="Collaboratori" />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: insets.bottom + 24,
          gap: 16,
        }}
        refreshControl={
          <RefreshControl
            refreshing={team.isRefetching}
            onRefresh={team.refetch}
            tintColor="#EAB54C"
          />
        }
      >
        {team.isError ? (
          <QueryError onRetry={team.refetch} />
        ) : members.length === 0 && !team.isPending ? (
          <EmptyState
            title="Nessun collaboratore"
            subtitle="Invita chi organizza i turni con te: sceglierai su quali sedi entra e cosa può fare."
          />
        ) : (
          members.map((m) => (
            <MemberCard
              key={m.userId ?? m.email ?? m.rows[0].id}
              member={m}
              venueName={venueName}
              onRevokeRow={(row) =>
                setConfirm({
                  ids: [row.id],
                  title: `Togliere l'accesso a ${venueName(row.venue_id)}?`,
                  message:
                    "Non vedrà più i turni né l'organico di questa sede. Glielo diciamo con una notifica.",
                })
              }
              onRevokeAll={(member) =>
                setConfirm({
                  ids: member.rows.map((r) => r.id),
                  title: "Revocare tutto?",
                  message:
                    "Perderà l'accesso a tutte le sedi. Quello che ha già fatto — turni, presenze, ore — resta dov'è.",
                })
              }
            />
          ))
        )}

        <GoldButton
          label="Invita un collaboratore"
          onPress={() => router.push("/(manager)/team/new")}
        />
      </ScrollView>

      <ConfirmModal
        visible={!!confirm}
        title={confirm?.title ?? ""}
        message={confirm?.message}
        confirmLabel="Revoca"
        destructive
        pending={revoke.isPending}
        onConfirm={doRevoke}
        onCancel={() => setConfirm(null)}
      />
    </View>
  );
}
