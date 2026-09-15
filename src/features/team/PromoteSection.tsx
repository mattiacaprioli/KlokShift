import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { Pressable, Text, View } from "@/tw";
import { useToast } from "@/providers/Toast";
import { userErrorMessage } from "@/lib/errors";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { Pill } from "@/components/ui/Pill";
import {
  usePersonAccess,
  usePromoteStaffPerson,
  useRevokeTeamAccess,
  useUpdateTeamPermissions,
} from "./hooks";
import {
  DEFAULT_TEAM_PERMISSIONS,
  PermissionSwitches,
} from "./PermissionSwitches";
import {
  permissionsOf,
  type TeamPermission,
  type TeamPermissions,
  type VenueAccess,
} from "./api";

/**
 * «Fagli gestire la sede»: la promozione di un membro dell'organico.
 *
 * Sta sulla scheda della persona e non nella lista dei collaboratori perché è lì
 * che la decisione nasce — il titolare sta guardando chi è il suo capo sala, non
 * cercando un indirizzo email. Per la stessa ragione non c'è nessun invito da
 * mandare: quella persona un account ce l'ha già, e il legame che la autorizza è
 * l'appartenenza all'organico di quella sede (vedi `promoteStaffPerson`).
 *
 * ⚠️ Solo per chi ha un account collegato. Una scheda senza `waiter_id` è
 * un'anagrafica che il titolare ha scritto a mano: non c'è nessuno a cui dare
 * l'accesso.
 *
 * ⚠️ Una riga per sede, come ovunque in `venue_access`: il capo sala del bar non
 * diventa il capo sala del ristorante perché lavora in entrambi.
 */
export function PromoteSection({
  ownerId,
  waiterId,
  personName,
  venueIds,
}: {
  ownerId: string;
  waiterId: string;
  personName: string;
  /** Le sedi in cui la persona è in organico **adesso**. */
  venueIds: string[];
}) {
  const { venueById } = useOwnerVenues();
  const accessQuery = usePersonAccess(ownerId, waiterId);

  if (venueIds.length === 0) return null;

  const rows = accessQuery.data ?? [];

  return (
    <View className="gap-3">
      <Mono>Gestione della sede</Mono>
      <Text className="-mt-1 px-1 text-[12px] leading-4 text-t4">
        {personName.split(/\s+/)[0]} continua a essere un professionista con i
        suoi turni: gli si aggiunge un secondo accesso, non gli si cambia
        l&apos;account. Non potrà mai assegnarsi turni né scriversi le ore.
      </Text>
      {venueIds.map((venueId) => (
        <PromoteVenueRow
          key={venueId}
          ownerId={ownerId}
          waiterId={waiterId}
          venueId={venueId}
          venueName={venueById(venueId)?.name ?? "Sede"}
          row={rows.find((r) => r.venue_id === venueId) ?? null}
        />
      ))}
    </View>
  );
}

function PromoteVenueRow({
  ownerId,
  waiterId,
  venueId,
  venueName,
  row,
}: {
  ownerId: string;
  waiterId: string;
  venueId: string;
  venueName: string;
  row: VenueAccess | null;
}) {
  const toast = useToast();
  const promote = usePromoteStaffPerson();
  const update = useUpdateTeamPermissions();
  const revoke = useRevokeTeamAccess();

  const active = row?.status === "active";
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // I permessi da dare alla prima promozione. Quando l'accesso esiste già si
  // legge dalla riga: è il database la fonte, non questo stato.
  const [draft, setDraft] = useState<TeamPermissions>(DEFAULT_TEAM_PERMISSIONS);

  const permissions = active && row ? permissionsOf(row) : draft;

  function setPerm(perm: TeamPermission, next: boolean) {
    if (active && row) {
      update.mutate(
        { accessId: row.id, permissions: { [perm]: next } },
        { onError: (e) => toast.show(userErrorMessage(e), "error") }
      );
      return;
    }
    setDraft((prev) => ({ ...prev, [perm]: next }));
  }

  function doPromote() {
    promote.mutate(
      { ownerId, venueId, userId: waiterId, permissions: draft },
      {
        onSuccess: () => toast.show(`Ora gestisce ${venueName}`),
        onError: (e) => toast.show(userErrorMessage(e), "error"),
      }
    );
  }

  return (
    <Card className="gap-3 rounded-3xl border-border-2 p-4">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center gap-3"
      >
        <View className="flex-1">
          <Text className="text-[15px] font-sans-semibold text-t1">
            {venueName}
          </Text>
          <Text className="mt-0.5 text-[13px] text-t3">
            {active ? "Gestisce questa sede" : "Non gestisce"}
          </Text>
        </View>
        {active ? <Pill label="Attivo" variant="accepted" /> : null}
        <Icon
          name="chevR"
          size={18}
          color="#6A6358"
          style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}
        />
      </Pressable>

      {open ? (
        <View className="gap-3 border-t border-border-1 pt-3">
          <PermissionSwitches value={permissions} onChange={setPerm} />
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
              disabled={promote.isPending}
              onPress={doPromote}
              className="items-center rounded-2xl border border-border-gold py-3"
            >
              <Text className="text-sm font-sans-semibold text-gold">
                {promote.isPending ? "Attivazione…" : "Fagli gestire la sede"}
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}

      <ConfirmModal
        visible={confirming}
        title={`Togliere la gestione di ${venueName}?`}
        message="Torna a essere solo un professionista: i suoi turni, le sue ore e la sua scheda restano intatti. Puoi ridargliela quando vuoi."
        confirmLabel="Togli"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          if (!row) return;
          revoke.mutate([row.id], {
            onSuccess: () => toast.show("Gestione revocata"),
            onError: (e) => toast.show(userErrorMessage(e), "error"),
          });
        }}
      />
    </Card>
  );
}
