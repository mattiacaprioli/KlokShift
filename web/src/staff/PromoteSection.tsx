import { useState } from "react";
import { userErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
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
import { PermissionChecks } from "../pages/Team";
import { useToast } from "../ui/Toast";
import { Button, Card, Pill } from "../ui/primitives";
import { useUnsavedEdit } from "@/lib/unsavedEdits";

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
 *
 * Niente salva al primo tocco: chi non collabora ancora parte da tutto spento e
 * conferma con «Fagli gestire l'azienda»; chi collabora già si guarda in
 * lettura e si cambia con «Modifica» → «Salva». Prima ogni interruttore
 * scriveva subito, e un clic di troppo dava (o toglieva) un permesso.
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
  /** Solo per chi collabora già: la griglia è aperta alle modifiche. */
  const [editing, setEditing] = useState(false);
  // La bozza: la prima promozione, o la modifica di un collaboratore attivo.
  // Si parte tutto spento, non con «Turni» acceso come prima: un permesso già acceso
  // su chi non collabora ancora sembrava un permesso concesso.
  const [draft, setDraft] = useState<TeamPermissions>(NO_PERMISSIONS);
  const [draftScope, setDraftScope] = useState<VenueScope>("all");
  const [draftVenues, setDraftVenues] = useState<Set<string>>(new Set());

  const current = accessQuery.data;
  const active = current?.authority === "collaborator";
  const reading = active && !editing;
  const permissions = reading && current ? current.permissions : draft;
  const scope = reading && current ? current.scope : draftScope;
  const scopeVenues =
    reading && current ? new Set(current.venueIds) : draftVenues;

  const draftEmpty = !Object.values(draft).some(Boolean);
  // «Solo alcune» senza nessuna sede scelta non vale da nessuna parte.
  const scopeIncomplete = draftScope === "selected" && draftVenues.size === 0;

  // Rispetto a cosa è «cambiato»: i permessi salvati se collabora, il tutto
  // spento se no.
  const base = active && current ? current : null;
  const dirty = active
    ? editing &&
      !!base &&
      (Object.keys(draft).some(
        (k) =>
          draft[k as TeamPermission] !== base.permissions[k as TeamPermission]
      ) ||
        draftScope !== base.scope ||
        (draftScope === "selected" &&
          (draftVenues.size !== base.venueIds.length ||
            base.venueIds.some((id) => !draftVenues.has(id)))))
    : !draftEmpty || draftScope !== "all" || draftVenues.size > 0;
  useUnsavedEdit("gestione", dirty);

  const firstName = personName.trim().split(/\s+/)[0] || "Questa persona";

  function startEditing() {
    if (!current) return;
    setDraft(current.permissions);
    setDraftScope(current.scope);
    setDraftVenues(new Set(current.venueIds));
    setConfirming(false);
    setEditing(true);
  }

  function resetDraft() {
    setDraft(NO_PERMISSIONS);
    setDraftScope("all");
    setDraftVenues(new Set());
  }

  function submit() {
    setAccess.mutate(
      {
        memberId,
        permissions: draft,
        scope: draftScope,
        venueIds: draftScope === "selected" ? [...draftVenues] : [],
      },
      {
        onSuccess: () => {
          toast.show(
            active
              ? "Permessi aggiornati"
              : `${firstName} ora collabora alla gestione`
          );
          setEditing(false);
          resetDraft();
        },
        onError: (e) => toast.show(userErrorMessage(e), "error"),
      }
    );
  }

  function setPerm(perm: TeamPermission, on: boolean) {
    setDraft((prev) => ({ ...prev, [perm]: on }));
  }

  function toggleVenue(id: string) {
    const next = new Set(draftVenues);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDraftVenues(next);
  }

  // Senza un account non c'è nessuno a cui dare l'accesso, e
  // `set_member_access` lo rifiuterebbe (`needs_account`).
  if (!waiterId) return null;

  const locked = reading || setAccess.isPending;

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

      <Card
        className={cn(
          "flex flex-col gap-4",
          editing && "border-gold/40"
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          {active ? (
            <Pill>Collabora alla gestione</Pill>
          ) : (
            <span className="text-xs text-t4">
              {draftEmpty
                ? "Scegli almeno un permesso, poi attiva."
                : "Niente è attivo finché non confermi."}
            </span>
          )}
          <span className="flex-1" />
          {!active ? (
            <Button
              variant="gold"
              disabled={setAccess.isPending || draftEmpty || scopeIncomplete}
              onClick={submit}
            >
              {setAccess.isPending
                ? "Attivazione…"
                : "Fagli gestire l'azienda"}
            </Button>
          ) : editing ? null : confirming ? (
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
                      resetDraft();
                    },
                    onError: (e) => toast.show(userErrorMessage(e), "error"),
                  })
                }
              >
                Conferma
              </Button>
            </span>
          ) : (
            <>
              <Button onClick={startEditing}>Modifica</Button>
              <Button variant="ghost" onClick={() => setConfirming(true)}>
                Togli la gestione
              </Button>
            </>
          )}
        </div>

        <PermissionChecks
          value={permissions}
          disabled={locked}
          onChange={setPerm}
        />

        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-t3">
            Su quali sedi
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={scope === "all" ? "gold" : undefined}
              disabled={locked}
              onClick={() => setDraftScope("all")}
            >
              Tutte le sedi
            </Button>
            <Button
              variant={scope === "selected" ? "gold" : undefined}
              disabled={locked}
              onClick={() => setDraftScope("selected")}
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
                  disabled={locked}
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
          {!reading && scopeIncomplete ? (
            <span className="text-xs text-warning">Scegli almeno una sede.</span>
          ) : null}
        </div>

        {editing ? (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button
              variant="gold"
              disabled={
                setAccess.isPending || !dirty || draftEmpty || scopeIncomplete
              }
              onClick={submit}
            >
              {setAccess.isPending ? "Salvataggio…" : "Salva"}
            </Button>
            <Button
              disabled={setAccess.isPending}
              onClick={() => setEditing(false)}
            >
              Annulla
            </Button>
            {draftEmpty ? (
              <span className="self-center text-xs text-t4">
                Senza permessi non collabora più: per quello c&apos;è «Togli la
                gestione».
              </span>
            ) : null}
          </div>
        ) : null}
      </Card>
    </section>
  );
}
