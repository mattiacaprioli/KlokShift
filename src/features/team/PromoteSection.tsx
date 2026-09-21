import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { EditActions } from "@/components/ui/EditSection";
import { GhostButton } from "@/components/ui/GhostButton";
import { Chip } from "@/components/ui/Chip";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Mono } from "@/components/ui/Mono";
import { Pressable, Text, View } from "@/tw";
import { useToast } from "@/providers/Toast";
import { cn } from "@/lib/cn";
import { userErrorMessage } from "@/lib/errors";
import { useUnsavedEdit } from "@/lib/unsavedEdits";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useMemberAccess, useRevokeTeamAccess, useSetTeamAccess } from "./hooks";
import { PermissionSwitches } from "./PermissionSwitches";
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
 * Niente salva al primo tocco: chi non collabora ancora parte da tutto spento e
 * conferma con «Fagli gestire l'azienda»; chi collabora già si guarda in
 * lettura e si cambia con «Modifica» → «Salva». Prima ogni interruttore
 * scriveva subito, e un tocco di troppo dava (o toglieva) un permesso.
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
  /** Solo per chi collabora già: la griglia è aperta alle modifiche. */
  const [editing, setEditing] = useState(false);
  // La bozza: la prima promozione, o la modifica di un collaboratore attivo.
  // Si parte tutto spento: un «Turni» già acceso su chi non collabora ancora
  // sembrava un permesso concesso.
  const [draft, setDraft] = useState<TeamPermissions>(NO_PERMISSIONS);
  const [draftScope, setDraftScope] = useState<VenueScope>("all");
  const [draftVenues, setDraftVenues] = useState<Set<string>>(new Set());

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
  const dirty =
    active && current
      ? editing &&
        ((Object.keys(draft) as TeamPermission[]).some(
          (k) => draft[k] !== current.permissions[k]
        ) ||
          draftScope !== current.scope ||
          (draftScope === "selected" &&
            (draftVenues.size !== current.venueIds.length ||
              current.venueIds.some((id) => !draftVenues.has(id)))))
      : !draftEmpty || draftScope !== "all" || draftVenues.size > 0;
  useUnsavedEdit("gestione", dirty);

  const firstName = personName.trim().split(/\s+/)[0] || "Questa persona";

  function startEditing() {
    if (!current) return;
    setDraft(current.permissions);
    setDraftScope(current.scope);
    setDraftVenues(new Set(current.venueIds));
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

  function toggleVenue(id: string) {
    setDraftVenues((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!waiterId) return null;

  const locked = reading || setAccess.isPending;

  return (
    <View className="gap-3">
      <Mono>Gestione dell&apos;azienda</Mono>
      <Text className="-mt-1 px-1 text-[12px] leading-4 text-t4">
        {firstName} continua a essere un professionista con i suoi turni: gli si
        aggiunge un secondo accesso, non gli si cambia l&apos;account. Può
        mettersi in turno da solo, ma le sue presenze e le sue ore le segna chi
        ha il permesso Ore.
      </Text>

      <Card
        className={cn(
          "gap-4 rounded-3xl border-border-2 p-4",
          editing && "border-gold/40"
        )}
      >
        {!active ? (
          <Text className="px-1 text-[12px] leading-4 text-t4">
            {draftEmpty
              ? "Scegli almeno un permesso, poi attiva."
              : "Niente è attivo finché non confermi."}
          </Text>
        ) : null}

        <PermissionSwitches
          value={permissions}
          onChange={(perm, next) =>
            setDraft((prev) => ({ ...prev, [perm]: next }))
          }
          disabled={locked}
        />

        <View className="gap-2">
          <Mono>Su quali sedi</Mono>
          <View className="flex-row gap-2">
            <Chip
              label="Tutte le sedi"
              gold
              active={scope === "all"}
              onPress={locked ? undefined : () => setDraftScope("all")}
            />
            <Chip
              label="Solo alcune"
              gold
              active={scope === "selected"}
              onPress={locked ? undefined : () => setDraftScope("selected")}
            />
          </View>
          {scope === "selected" ? (
            <View className="mt-1 flex-row flex-wrap gap-2">
              {venues.map((v) => (
                <Chip
                  key={v.id}
                  label={v.name}
                  active={scopeVenues.has(v.id)}
                  onPress={locked ? undefined : () => toggleVenue(v.id)}
                />
              ))}
            </View>
          ) : null}
          {!reading && scopeIncomplete ? (
            <Text className="text-[12px] text-warning">
              Scegli almeno una sede.
            </Text>
          ) : null}
        </View>

        {!active ? (
          <Pressable
            disabled={setAccess.isPending || draftEmpty || scopeIncomplete}
            onPress={submit}
            className={cn(
              "items-center rounded-2xl border border-border-gold py-3",
              (draftEmpty || scopeIncomplete) && "opacity-40"
            )}
          >
            <Text className="text-sm font-sans-semibold text-gold">
              {setAccess.isPending ? "Attivazione…" : "Fagli gestire l'azienda"}
            </Text>
          </Pressable>
        ) : editing ? (
          <View className="gap-2">
            <EditActions
              pending={setAccess.isPending}
              canSave={dirty && !draftEmpty && !scopeIncomplete}
              onSave={submit}
              onCancel={() => setEditing(false)}
            />
            {draftEmpty ? (
              <Text className="px-1 text-[12px] leading-4 text-t4">
                Senza permessi non collabora più: per quello c&apos;è «Togli la
                gestione».
              </Text>
            ) : null}
          </View>
        ) : (
          <View className="gap-3">
            <GhostButton label="Modifica" onPress={startEditing} />
            <Pressable
              disabled={revoke.isPending}
              onPress={() => setConfirming(true)}
              className="items-center py-1"
            >
              <Text className="text-sm font-sans-semibold text-error">
                Togli la gestione
              </Text>
            </Pressable>
          </View>
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
              resetDraft();
            },
            onError: (e) => toast.show(userErrorMessage(e), "error"),
          });
        }}
      />
    </View>
  );
}
