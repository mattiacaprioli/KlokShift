import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Mono } from "@/components/ui/Mono";
import { Pressable, Text, View } from "@/tw";
import { useToast } from "@/providers/Toast";
import { userErrorMessage } from "@/lib/errors";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useMemberAccess, useRevokeTeamAccess, useSetTeamAccess } from "./hooks";
import { DEFAULT_TEAM_PERMISSIONS, PermissionSwitches } from "./PermissionSwitches";
import { NO_PERMISSIONS, type TeamPermission, type TeamPermissions } from "./api";
import type { VenueScope } from "@/features/workspace/types";

/**
 * «Fagli gestire l'azienda»: la promozione di una persona a collaboratore.
 *
 * Sta sulla scheda della persona e non nella lista dei collaboratori perché è lì
 * che la decisione nasce — il titolare sta guardando chi è quella persona, non
 * cercando un indirizzo email. Per la stessa ragione non c'è nessun invito da
 * mandare: quella persona un account ce l'ha già.
 *
 * Dal 20/09/2026 i permessi e l'ambito stanno **sul membro**, non più per sede:
 * una griglia sola di cinque interruttori, più la scelta fra "tutte le sedi" e
 * "solo alcune" (`set_member_access`, solo titolare).
 *
 * ⚠️ Solo per chi ha un account collegato. Una scheda senza `waiter_id` è
 * un'anagrafica che il titolare ha scritto a mano: non c'è nessuno a cui dare
 * l'accesso, e `set_member_access` lo rifiuterebbe (`needs_account`).
 */
export function PromoteSection({
  memberId,
  waiterId,
  personName,
}: {
  memberId: string;
  waiterId: string;
  personName: string;
}) {
  const { venues } = useOwnerVenues();
  const toast = useToast();
  const accessQuery = useMemberAccess(memberId);
  const setAccess = useSetTeamAccess();
  const revoke = useRevokeTeamAccess();

  const current = accessQuery.data;
  const active = current?.authority === "collaborator";

  const [confirming, setConfirming] = useState(false);
  // I permessi e l'ambito da dare alla prima promozione. Una volta attivo si
  // legge e si scrive dal database, non da questo stato.
  const [draft, setDraft] = useState<TeamPermissions>(DEFAULT_TEAM_PERMISSIONS);
  const [scope, setScope] = useState<VenueScope>("all");
  const [scopeVenues, setScopeVenues] = useState<Set<string>>(new Set());

  const permissions = active && current ? current.permissions : draft;
  const currentScope = active && current ? current.scope : scope;
  const currentScopeVenues =
    active && current ? new Set(current.venueIds) : scopeVenues;

  function toggleScopeVenue(id: string) {
    setScopeVenues((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setPerm(perm: TeamPermission, next: boolean) {
    if (active) {
      setAccess.mutate(
        {
          memberId,
          permissions: { ...permissions, [perm]: next },
          scope: currentScope,
          venueIds: [...currentScopeVenues],
        },
        { onError: (e) => toast.show(userErrorMessage(e), "error") }
      );
      return;
    }
    setDraft((prev) => ({ ...prev, [perm]: next }));
  }

  function setScopeChoice(next: VenueScope) {
    if (active) {
      setAccess.mutate(
        {
          memberId,
          permissions,
          scope: next,
          venueIds: [...currentScopeVenues],
        },
        { onError: (e) => toast.show(userErrorMessage(e), "error") }
      );
      return;
    }
    setScope(next);
  }

  function toggleVenue(id: string) {
    if (active) {
      const next = new Set(currentScopeVenues);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setAccess.mutate(
        { memberId, permissions, scope: "selected", venueIds: [...next] },
        { onError: (e) => toast.show(userErrorMessage(e), "error") }
      );
      return;
    }
    toggleScopeVenue(id);
  }

  function doPromote() {
    setAccess.mutate(
      { memberId, permissions: draft, scope, venueIds: [...scopeVenues] },
      {
        onSuccess: () => toast.show(`${personName.split(/\s+/)[0]} ora collabora alla gestione`),
        onError: (e) => toast.show(userErrorMessage(e), "error"),
      }
    );
  }

  if (!waiterId) return null;

  return (
    <View className="gap-3">
      <Mono>Gestione dell&apos;azienda</Mono>
      <Text className="-mt-1 px-1 text-[12px] leading-4 text-t4">
        {personName.split(/\s+/)[0]} continua a essere un professionista con i
        suoi turni: gli si aggiunge un secondo accesso, non gli si cambia
        l&apos;account. Può mettersi in turno da solo, ma le sue presenze e le
        sue ore le segna chi ha il permesso Ore.
      </Text>

      <Card className="gap-4 rounded-3xl border-border-2 p-4">
        <PermissionSwitches
          value={active ? permissions : draft}
          onChange={setPerm}
          disabled={setAccess.isPending}
        />

        <View className="gap-2">
          <Mono>Su quali sedi</Mono>
          <View className="flex-row gap-2">
            <Chip
              label="Tutte le sedi"
              gold
              active={currentScope === "all"}
              onPress={() => setScopeChoice("all")}
            />
            <Chip
              label="Solo alcune"
              gold
              active={currentScope === "selected"}
              onPress={() => setScopeChoice("selected")}
            />
          </View>
          {currentScope === "selected" ? (
            <View className="mt-1 flex-row flex-wrap gap-2">
              {venues.map((v) => (
                <Chip
                  key={v.id}
                  label={v.name}
                  active={currentScopeVenues.has(v.id)}
                  onPress={() => toggleVenue(v.id)}
                />
              ))}
            </View>
          ) : null}
        </View>

        {active ? (
          <Pressable
            disabled={revoke.isPending}
            onPress={() => setConfirming(true)}
            className="items-center rounded-2xl border border-border-2 py-3"
          >
            <Text className="text-sm font-sans-semibold text-error">
              Togli la gestione
            </Text>
          </Pressable>
        ) : (
          <Pressable
            disabled={setAccess.isPending}
            onPress={doPromote}
            className="items-center rounded-2xl border border-border-gold py-3"
          >
            <Text className="text-sm font-sans-semibold text-gold">
              {setAccess.isPending ? "Attivazione…" : "Fagli gestire l'azienda"}
            </Text>
          </Pressable>
        )}
      </Card>

      <ConfirmModal
        visible={confirming}
        title="Togliere la gestione?"
        message={`${personName} torna a essere solo un professionista: i suoi turni, le sue ore e la sua scheda restano intatti. Puoi ridargliela quando vuoi.`}
        confirmLabel="Togli"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          revoke.mutate(memberId, {
            onSuccess: () => {
              toast.show("Gestione revocata");
              setDraft(NO_PERMISSIONS);
              setScope("all");
              setScopeVenues(new Set());
            },
            onError: (e) => toast.show(userErrorMessage(e), "error"),
          });
        }}
      />
    </View>
  );
}
