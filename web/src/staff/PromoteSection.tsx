import { useState } from "react";
import { userErrorMessage } from "@/lib/errors";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import {
  permissionsOf,
  type TeamPermission,
  type TeamPermissions,
  type VenueAccess,
} from "@/features/team/api";
import {
  usePersonAccess,
  usePromoteStaffPerson,
  useRevokeTeamAccess,
  useUpdateTeamPermissions,
} from "@/features/team/hooks";
import { DEFAULT_PERMISSIONS, PermissionChecks } from "../pages/Team";
import { useToast } from "../ui/Toast";
import { Button, Card, Pill } from "../ui/primitives";

/**
 * «Fagli gestire la sede»: la promozione di un membro dell'organico.
 *
 * Gemella di `src/features/team/PromoteSection.tsx`, che è l'app. Due file e non
 * uno perché la parte condivisa (api + hooks) è già condivisa: qui resta solo il
 * markup, che su una scrivania è un pannello e sul telefono una card
 * espandibile.
 *
 * Sta sulla scheda della persona e non nella lista dei collaboratori perché è lì
 * che la decisione nasce — il titolare sta guardando chi è il suo capo sala, non
 * cercando un indirizzo email. Nessun invito da mandare: quella persona un
 * account ce l'ha già, e ad autorizzarla è l'appartenenza all'organico di
 * **quella** sede (vedi `promoteStaffPerson`).
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
  const firstName = personName.trim().split(/\s+/)[0] || "Questa persona";

  return (
    <section className="flex flex-col gap-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-t3">
        Gestione della sede
      </span>
      <p className="-mt-1 text-xs leading-5 text-t3">
        {firstName} continua a essere un professionista con i suoi turni: gli si
        aggiunge un secondo accesso, non gli si cambia l&apos;account. Non potrà
        mai assegnarsi turni né scriversi le ore.
      </p>
      {venueIds.map((venueId) => (
        <PromoteVenueCard
          key={venueId}
          ownerId={ownerId}
          waiterId={waiterId}
          venueId={venueId}
          venueName={venueById(venueId)?.name ?? "Sede"}
          row={rows.find((r) => r.venue_id === venueId) ?? null}
        />
      ))}
    </section>
  );
}

function PromoteVenueCard({
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
  const [confirming, setConfirming] = useState(false);
  // I permessi della prima promozione. Quando l'accesso esiste già si legge
  // dalla riga: la fonte è il database, non questo stato.
  const [draft, setDraft] = useState<TeamPermissions>(DEFAULT_PERMISSIONS);

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

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-t1">{venueName}</span>
          {active ? <Pill tone="success">Gestisce</Pill> : null}
        </span>

        {active ? (
          confirming ? (
            <span className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Annulla
              </Button>
              <Button
                variant="danger"
                disabled={revoke.isPending || !row}
                onClick={() => {
                  if (!row) return;
                  revoke.mutate([row.id], {
                    onSuccess: () => {
                      setConfirming(false);
                      toast.show("Gestione revocata");
                    },
                    onError: (e) => toast.show(userErrorMessage(e), "error"),
                  });
                }}
              >
                Conferma
              </Button>
            </span>
          ) : (
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              Togli la gestione
            </Button>
          )
        ) : (
          <Button
            variant="gold"
            disabled={promote.isPending}
            onClick={() =>
              promote.mutate(
                { ownerId, venueId, userId: waiterId, permissions: draft },
                {
                  onSuccess: () => toast.show(`Ora gestisce ${venueName}`),
                  onError: (e) => toast.show(userErrorMessage(e), "error"),
                }
              )
            }
          >
            {promote.isPending ? "Attivazione…" : "Fagli gestire la sede"}
          </Button>
        )}
      </div>

      <PermissionChecks
        value={permissions}
        disabled={update.isPending}
        onChange={setPerm}
      />
    </Card>
  );
}
