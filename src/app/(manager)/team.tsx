import { useState } from "react";
import { useRouter } from "expo-router";
import { RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { EditActions } from "@/components/ui/EditSection";
import { EmptyState } from "@/components/ui/EmptyState";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { Pill } from "@/components/ui/Pill";
import { QueryError } from "@/components/ui/QueryError";
import { SelectChip } from "@/components/ui/SelectChip";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useToast } from "@/providers/Toast";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import {
  useRevokeTeamAccess,
  useSendTeamInvite,
  useSetTeamAccess,
  useTeam,
} from "@/features/team/hooks";
import { PermissionSwitches } from "@/features/team/PermissionSwitches";
import {
  TEAM_PERMISSIONS,
  TEAM_PERMISSION_LABEL,
  type TeamMember,
  type TeamPermission,
  type TeamPermissions,
} from "@/features/team/api";
import type { VenueScope } from "@/features/workspace/types";
import { cn } from "@/lib/cn";
import { userErrorMessage } from "@/lib/errors";

/** Le aree accese, in due parole. "Nessun permesso" se nessuna. */
function permissionSummary(p: TeamPermissions): string {
  const on = TEAM_PERMISSIONS.filter((k) => p[k]).map(
    (k) => TEAM_PERMISSION_LABEL[k]
  );
  return on.length > 0 ? on.join(" · ") : "Nessun permesso";
}

/**
 * Su quali sedi vale l'accesso, in una riga.
 *
 * «Tutte le sedi» comprende anche quelle che l'azienda aprirà domani: è la
 * differenza che conta rispetto a un elenco, ed è il motivo per cui l'ambito è
 * una scelta e non una lista di spunte con tutte le caselle piene.
 */
function scopeSummary(member: TeamMember, venueName: (id: string) => string): string {
  if (member.scope === "all") return "Tutte le sedi, anche quelle future";
  if (member.venueIds.length === 0) return "Nessuna sede";
  return member.venueIds.map(venueName).join(" · ");
}

/**
 * Una persona che collabora alla gestione: permessi, ambito e revoca.
 *
 * ⚠️ I permessi stanno **sulla persona**, non sulla sede. Prima erano una riga
 * per (persona, sede) e si potevano dare mestieri diversi in sedi diverse: in
 * pratica non succedeva mai, e ogni regola del database doveva chiedersi «su
 * quale sede?» anche quando la risposta era sempre la stessa. Adesso si sceglie
 * cosa può fare, e poi dove.
 */
function MemberCard({
  member,
  venueName,
  onRevoke,
}: {
  member: TeamMember;
  venueName: (id: string) => string;
  onRevoke: () => void;
}) {
  const toast = useToast();
  const { venues } = useOwnerVenues();
  const invite = useSendTeamInvite();
  const save = useSetTeamAccess();
  const [open, setOpen] = useState(false);
  // Aperta, la card si legge; si cambia solo dopo «Modifica». Prima ogni
  // interruttore salvava al tocco, e un tocco di troppo dava o toglieva un
  // permesso a qualcuno.
  const [editing, setEditing] = useState(false);
  const [permissions, setPermissions] = useState(member.permissions);
  const [scope, setScope] = useState<VenueScope>(member.scope);
  const [venueIds, setVenueIds] = useState<string[]>(member.venueIds);

  const pending = member.status === "pending";
  const title = member.fullName?.trim() || member.email || "Collaboratore";

  const noPermissions = !Object.values(permissions).some(Boolean);
  const scopeIncomplete = scope === "selected" && venueIds.length === 0;
  const dirty =
    (Object.keys(permissions) as TeamPermission[]).some(
      (p) => permissions[p] !== member.permissions[p]
    ) ||
    scope !== member.scope ||
    (scope === "selected" &&
      (venueIds.length !== member.venueIds.length ||
        venueIds.some((id) => !member.venueIds.includes(id))));

  function startEditing() {
    setPermissions(member.permissions);
    setScope(member.scope);
    setVenueIds(member.venueIds);
    setEditing(true);
  }

  function submit() {
    save.mutate(
      {
        memberId: member.memberId,
        permissions,
        scope,
        venueIds: scope === "selected" ? venueIds : [],
      },
      {
        onSuccess: () => {
          toast.show("Permessi aggiornati");
          setEditing(false);
        },
        onError: (e) => toast.show(userErrorMessage(e), "error"),
      }
    );
  }

  function toggleVenue(venueId: string) {
    setVenueIds((prev) =>
      prev.includes(venueId)
        ? prev.filter((id) => id !== venueId)
        : [...prev, venueId]
    );
  }

  return (
    <Card className="gap-0 p-0">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center gap-3 px-4 py-3.5"
      >
        <Avatar uri={member.avatarUrl ?? undefined} name={title} size={38} />
        <View className="flex-1">
          <Text className="text-[15px] font-sans-semibold text-t1" numberOfLines={1}>
            {title}
          </Text>
          <Text className="mt-0.5 text-[13px] text-t3" numberOfLines={1}>
            {permissionSummary(member.permissions)}
          </Text>
          <Text className="mt-0.5 text-[12px] leading-4 text-t4" numberOfLines={1}>
            {scopeSummary(member, venueName)}
          </Text>
        </View>
        {pending ? <Pill label="Invito mandato" /> : null}
        {/* Niente "chevD" fra le icone: la chevron si ruota, ed è il caso per
            cui `Icon` accetta uno `style`. */}
        <Icon
          name="chevR"
          size={16}
          color="#6A6358"
          style={open ? { transform: [{ rotate: "90deg" }] } : undefined}
        />
      </Pressable>

      {pending ? (
        <View className="gap-2 border-t border-border-1 px-4 py-3">
          {/* Due strade, e vanno dette tutt'e due: chi non aveva un account lo
              crea aprendo il link, chi ce l'ha già accetta l'invito dall'app.
              Nominarne una sola fa sembrare l'invito rotto all'altra metà. */}
          <Text className="text-[12px] leading-4 text-t3">
            Se non aveva un account, lo crea aprendo il link che gli abbiamo
            mandato e scegliendo una password. Se ce l&apos;aveva già, trova
            l&apos;invito da accettare quando entra.
          </Text>
          <GhostButton
            label={invite.isPending ? "Invio…" : "Reinvia l'invito"}
            onPress={() =>
              invite.mutate(member.memberId, {
                onSuccess: () => toast.show("Invito spedito"),
                onError: (e) => toast.show(userErrorMessage(e), "error"),
              })
            }
          />
        </View>
      ) : null}

      {open ? (
        <View
          className={cn(
            "gap-4 border-t border-border-1 px-4 py-4",
            editing && "border-gold/40"
          )}
        >
          <PermissionSwitches
            value={editing ? permissions : member.permissions}
            onChange={(perm: TeamPermission, next: boolean) =>
              setPermissions((prev) => ({ ...prev, [perm]: next }))
            }
            disabled={!editing || save.isPending}
          />

          <View className="gap-2">
            <Text className="text-[13px] font-sans-semibold text-t2">Dove</Text>
            {editing ? (
              <>
                <View className="flex-row flex-wrap gap-2">
                  <SelectChip
                    label="Tutte le sedi"
                    active={scope === "all"}
                    onPress={() =>
                      setScope(scope === "all" ? "selected" : "all")
                    }
                  />
                  {scope === "selected"
                    ? venues.map((v) => (
                        <SelectChip
                          key={v.id}
                          label={v.name}
                          active={venueIds.includes(v.id)}
                          onPress={() => toggleVenue(v.id)}
                        />
                      ))
                    : null}
                </View>
                {scope === "all" ? (
                  <Text className="text-[12px] leading-4 text-t4">
                    Comprende anche le sedi che aprirai in futuro.
                  </Text>
                ) : scopeIncomplete ? (
                  <Text className="text-[12px] leading-4 text-warning">
                    Scegli almeno una sede.
                  </Text>
                ) : null}
              </>
            ) : (
              <Text className="text-[14px] leading-5 text-t1">
                {scopeSummary(member, venueName)}
              </Text>
            )}
          </View>

          {editing ? (
            <View className="gap-2">
              <EditActions
                pending={save.isPending}
                canSave={dirty && !noPermissions && !scopeIncomplete}
                onSave={submit}
                onCancel={() => setEditing(false)}
              />
              {noPermissions ? (
                <Text className="px-1 text-[12px] leading-4 text-t4">
                  Senza permessi non collabora più: per quello c&apos;è «Togli
                  l&apos;accesso».
                </Text>
              ) : null}
            </View>
          ) : (
            <View className="gap-3">
              <GhostButton label="Modifica" onPress={startEditing} />
              <Pressable onPress={onRevoke} className="items-center py-1">
                <Text className="text-sm font-sans-semibold text-error">
                  Togli l&apos;accesso
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}
    </Card>
  );
}

/**
 * I collaboratori del titolare.
 *
 * Il caso che risolve: due persone che organizzano i turni della stessa sede e
 * finora si passavano le credenziali di un account solo. Da qui ognuna ha il suo
 * accesso, con i permessi e sulle sedi che il titolare sceglie.
 *
 * ⚠️ Schermata del **titolare**: un collaboratore non la vede (né la rotta, né la
 * riga in Impostazioni). Non è una difesa — quella è il DB, che lascia a
 * `set_member_access` il solo titolare e a ciascuno la propria riga.
 */
export default function TeamScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { workspaceId, venueById, isOwner } = useOwnerVenues();
  const team = useTeam(isOwner ? (workspaceId ?? "") : "");
  const revoke = useRevokeTeamAccess();

  /** Chi si sta per revocare. */
  const [confirm, setConfirm] = useState<TeamMember | null>(null);

  const members = team.data ?? [];

  function venueName(id: string): string {
    return venueById(id)?.name ?? "Sede";
  }

  function doRevoke() {
    if (!confirm) return;
    revoke.mutate(confirm.memberId, {
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
            subtitle="Invita chi organizza i turni con te: sceglierai cosa può fare e su quali sedi."
          />
        ) : (
          members.map((m) => (
            <MemberCard
              key={m.memberId}
              member={m}
              venueName={venueName}
              onRevoke={() => setConfirm(m)}
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
        title="Togliere l'accesso?"
        message="Non gestirà più le tue sedi. Quello che ha già fatto — turni, presenze, ore — resta dov'è, e se lavora con voi resta in organico."
        confirmLabel="Togli"
        destructive
        pending={revoke.isPending}
        onConfirm={doRevoke}
        onCancel={() => setConfirm(null)}
      />
    </View>
  );
}
