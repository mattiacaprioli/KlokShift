import { useState } from "react";
import { userErrorMessage } from "@/lib/errors";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import {
  NO_PERMISSIONS,
  type TeamPermission,
  type TeamPermissions,
} from "@/features/team/api";
import {
  useMemberAccess,
  useRevokeTeamAccess,
  useSetTeamAccess,
} from "@/features/team/hooks";
import type { VenueScope } from "@/features/workspace/types";
import { DEFAULT_PERMISSIONS, PermissionChecks } from "../pages/Team";
import { useToast } from "../ui/Toast";
import { Button, Card, Pill } from "../ui/primitives";

/**
 * «Fagli gestire l'azienda»: la promozione di una persona dell'organico.
 *
 * Gemella di `src/features/team/PromoteSection.tsx`, che è l'app. Due file e non
 * uno perché la parte condivisa (api + hooks) è già condivisa: qui resta solo il
 * markup, che su una scrivania è un pannello e sul telefono una card
 * espandibile.
 *
 * Sta sulla scheda della persona e non nella lista dei collaboratori perché è lì
 * che la decisione nasce — il titolare sta guardando chi è il suo capo sala, non
 * cercando un indirizzo email. Nessun invito da mandare: quella persona un
 * account ce l'ha già.
 *
 * Dal 20/09/2026 permessi e ambito stanno **sul membro**, non per sede: una
 * griglia sola, più la scelta fra «tutte le sedi» e «solo alcune».
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
  const toast = useToast();
  const { venues } = useOwnerVenues();
  const accessQuery = useMemberAccess(memberId);
  const setAccess = useSetTeamAccess();
  const revoke = useRevokeTeamAccess();

  const [confirming, setConfirming] = useState(false);
  // Permessi e ambito della **prima** promozione. Una volta attivo si legge e si
  // scrive dal database, non da questo stato.
  const [draft, setDraft] = useState<TeamPermissions>(DEFAULT_PERMISSIONS);
  const [draftScope, setDraftScope] = useState<VenueScope>("all");
  const [draftVenues, setDraftVenues] = useState<Set<string>>(new Set());

  const current = accessQuery.data;
  const active = current?.authority === "collaborator";
  const permissions = active && current ? current.permissions : draft;
  const scope = active && current ? current.scope : draftScope;
  const scopeVenues =
    active && current ? new Set(current.venueIds) : draftVenues;

  const firstName = personName.trim().split(/\s+/)[0] || "Questa persona";

  /** Un cambio per volta: la RPC vuole permessi e ambito insieme. */
  function save(next: {
    permissions?: TeamPermissions;
    scope?: VenueScope;
    venueIds?: string[];
  }) {
    setAccess.mutate(
      {
        memberId,
        permissions: next.permissions ?? permissions,
        scope: next.scope ?? scope,
        venueIds: next.venueIds ?? [...scopeVenues],
      },
      { onError: (e) => toast.show(userErrorMessage(e), "error") }
    );
  }

  function setPerm(perm: TeamPermission, on: boolean) {
    if (active) return save({ permissions: { ...permissions, [perm]: on } });
    setDraft((prev) => ({ ...prev, [perm]: on }));
  }

  function setScope(next: VenueScope) {
    if (active) return save({ scope: next });
    setDraftScope(next);
  }

  function toggleVenue(id: string) {
    const next = new Set(scopeVenues);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    if (active) return save({ scope: "selected", venueIds: [...next] });
    setDraftVenues(next);
  }

  // Senza un account non c'è nessuno a cui dare l'accesso, e
  // `set_member_access` lo rifiuterebbe (`needs_account`).
  if (!waiterId) return null;

  return (
    <section className="flex flex-col gap-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-t3">
        Gestione dell&apos;azienda
      </span>
      <p className="-mt-1 text-xs leading-5 text-t3">
        {firstName} continua a essere un professionista con i suoi turni: gli si
        aggiunge un secondo accesso, non gli si cambia l&apos;account. Può
        mettersi in turno da solo, ma le sue presenze e le sue ore le segna chi
        ha il permesso Ore.
      </p>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {active ? <Pill>Collabora alla gestione</Pill> : null}
          <span className="flex-1" />
          {active ? (
            confirming ? (
              <span className="flex items-center gap-2">
                <span className="text-xs text-t3">
                  Torna a essere solo un professionista?
                </span>
                <Button onClick={() => setConfirming(false)}>Annulla</Button>
                <Button
                  variant="danger"
                  disabled={revoke.isPending}
                  onClick={() =>
                    revoke.mutate(memberId, {
                      onSuccess: () => {
                        setConfirming(false);
                        toast.show("Gestione revocata");
                        setDraft(NO_PERMISSIONS);
                        setDraftScope("all");
                        setDraftVenues(new Set());
                      },
                      onError: (e) => toast.show(userErrorMessage(e), "error"),
                    })
                  }
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
              disabled={setAccess.isPending}
              onClick={() =>
                setAccess.mutate(
                  {
                    memberId,
                    permissions: draft,
                    scope: draftScope,
                    venueIds: [...draftVenues],
                  },
                  {
                    onSuccess: () =>
                      toast.show(`${firstName} ora collabora alla gestione`),
                    onError: (e) => toast.show(userErrorMessage(e), "error"),
                  }
                )
              }
            >
              {setAccess.isPending
                ? "Attivazione…"
                : "Fagli gestire l'azienda"}
            </Button>
          )}
        </div>

        <PermissionChecks
          value={permissions}
          disabled={setAccess.isPending}
          onChange={setPerm}
        />

        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-t3">
            Su quali sedi
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={scope === "all" ? "gold" : undefined}
              onClick={() => setScope("all")}
            >
              Tutte le sedi
            </Button>
            <Button
              variant={scope === "selected" ? "gold" : undefined}
              onClick={() => setScope("selected")}
            >
              Solo alcune
            </Button>
          </div>
          {scope === "selected" ? (
            <div className="flex flex-wrap gap-2">
              {venues.map((v) => (
                <Button
                  key={v.id}
                  variant={scopeVenues.has(v.id) ? "gold" : undefined}
                  onClick={() => toggleVenue(v.id)}
                >
                  {v.name}
                </Button>
              ))}
            </div>
          ) : (
            <span className="text-xs text-t4">
              Comprende anche le sedi che aprirai in futuro.
            </span>
          )}
        </div>
      </Card>
    </section>
  );
}
