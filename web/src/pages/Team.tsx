import { useState } from "react";
import { Navigate } from "react-router-dom";
import { userErrorMessage } from "@/lib/errors";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import {
  permissionsOf,
  TEAM_PERMISSIONS,
  TEAM_PERMISSION_HINT,
  TEAM_PERMISSION_LABEL,
  type TeamMember,
  type TeamPermission,
  type TeamPermissions,
  type VenueAccess,
} from "@/features/team/api";
import {
  useAddTeamMember,
  useRevokeTeamAccess,
  useSendTeamInvite,
  useTeam,
  useUpdateTeamPermissions,
} from "@/features/team/hooks";
import { NoVenues } from "../venues/NoVenues";
import { Avatar } from "../ui/Avatar";
import { useToast } from "../ui/Toast";
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Pill,
  Placeholder,
  QueryError,
  Spinner,
} from "../ui/primitives";

const DEFAULT_PERMISSIONS: TeamPermissions = {
  can_manage_shifts: true,
  can_manage_staff: false,
  can_view_hours: false,
  can_manage_documents: false,
  can_manage_venue: false,
};

/** Una casella per area di permesso. */
function PermissionChecks({
  value,
  onChange,
  disabled,
}: {
  value: TeamPermissions;
  onChange: (perm: TeamPermission, next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {TEAM_PERMISSIONS.map((perm) => (
        <label
          key={perm}
          className="flex cursor-pointer items-start gap-3 rounded-xl border border-border px-3 py-2.5"
        >
          <input
            type="checkbox"
            className="mt-1 accent-gold"
            checked={value[perm]}
            disabled={disabled}
            onChange={(e) => onChange(perm, e.target.checked)}
          />
          <span className="flex-1">
            <span className="block text-sm font-semibold text-t1">
              {TEAM_PERMISSION_LABEL[perm]}
            </span>
            <span className="block text-xs text-t3">
              {TEAM_PERMISSION_HINT[perm]}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

/** Le sedi di un collaboratore, ognuna con i suoi permessi. */
function VenueAccessRow({ row }: { row: VenueAccess }) {
  const toast = useToast();
  const { venueById } = useOwnerVenues();
  const update = useUpdateTeamPermissions();
  const revoke = useRevokeTeamAccess();
  const [confirming, setConfirming] = useState(false);

  const name = venueById(row.venue_id)?.name ?? "Sede";

  return (
    <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-t1">{name}</span>
        {confirming ? (
          <span className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Annulla
            </Button>
            <Button
              variant="danger"
              disabled={revoke.isPending}
              onClick={() =>
                revoke.mutate([row.id], {
                  onSuccess: () => toast.show("Accesso revocato"),
                  onError: (e) => toast.show(userErrorMessage(e), "error"),
                })
              }
            >
              Conferma
            </Button>
          </span>
        ) : (
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            Togli l&apos;accesso
          </Button>
        )}
      </div>
      <PermissionChecks
        value={permissionsOf(row)}
        disabled={update.isPending}
        onChange={(perm, next) =>
          update.mutate(
            { accessId: row.id, permissions: { [perm]: next } },
            { onError: (e) => toast.show(userErrorMessage(e), "error") }
          )
        }
      />
    </div>
  );
}

function MemberCard({ member }: { member: TeamMember }) {
  const toast = useToast();
  const invite = useSendTeamInvite();
  const pending = member.status === "pending";
  const title = member.fullName?.trim() || member.email || "Collaboratore";

  return (
    <Card className="flex flex-col p-0">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <Avatar url={member.avatarUrl} name={title} size={38} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-t1">{title}</p>
          <p className="truncate text-xs text-t3">
            {member.email ?? "Account collegato"}
          </p>
        </div>
        {pending ? <Pill tone="warning">In attesa</Pill> : null}
      </div>

      {pending ? (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p className="text-xs text-t3">
            Si collega da solo quando si registra con questa email scegliendo
            «Gestisco un locale».
          </p>
          <Button
            variant="ghost"
            disabled={invite.isPending}
            onClick={() =>
              invite.mutate(member.rows[0].id, {
                onSuccess: () => toast.show("Invito spedito"),
                onError: (e) => toast.show(userErrorMessage(e), "error"),
              })
            }
          >
            Reinvia
          </Button>
        </div>
      ) : null}

      {member.rows.map((row) => (
        <VenueAccessRow key={row.id} row={row} />
      ))}
    </Card>
  );
}

/** Il modulo d'invito: email, sedi, permessi. */
function InviteForm({ ownerId }: { ownerId: string }) {
  const toast = useToast();
  const { venues, isMultiVenue } = useOwnerVenues();
  const add = useAddTeamMember();

  const [email, setEmail] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [permissions, setPermissions] =
    useState<TeamPermissions>(DEFAULT_PERMISSIONS);

  const venueIds = isMultiVenue ? picked : venues.map((v) => v.id);

  function submit() {
    if (!email.trim() || venueIds.length === 0) return;
    add.mutate(
      { ownerId, email: email.trim(), venueIds, permissions },
      {
        onSuccess: (res) => {
          if (res.kind === "already") {
            toast.show("Ha già accesso a queste sedi.", "error");
            return;
          }
          toast.show(
            res.kind === "linked"
              ? `${res.name ?? "Il collaboratore"} ora ha accesso`
              : res.emailSent
                ? "Invito spedito"
                : "Invito creato · email non spedita, riprova dalla lista"
          );
          setEmail("");
          setPicked([]);
          setPermissions(DEFAULT_PERMISSIONS);
        },
        onError: (e) => toast.show(userErrorMessage(e), "error"),
      }
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-t1">Invita un collaboratore</h2>

      <Field label="Email">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nome@email.com"
        />
      </Field>

      {isMultiVenue ? (
        <Field label="Su quali sedi">
          <div className="flex flex-wrap gap-2">
            {venues.map((v) => {
              const on = picked.includes(v.id);
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() =>
                    setPicked((prev) =>
                      on ? prev.filter((id) => id !== v.id) : [...prev, v.id]
                    )
                  }
                  className={
                    on
                      ? "rounded-full border border-gold bg-bg-2 px-3 py-1.5 text-xs text-t1"
                      : "rounded-full border border-border px-3 py-1.5 text-xs text-t3"
                  }
                >
                  {v.name}
                </button>
              );
            })}
          </div>
        </Field>
      ) : null}

      <Field label="Cosa può fare">
        <PermissionChecks
          value={permissions}
          onChange={(perm, next) =>
            setPermissions((prev) => ({ ...prev, [perm]: next }))
          }
        />
      </Field>

      <p className="text-xs text-t3">
        Restano tuoi: aprire e chiudere sedi, invitare altri collaboratori e
        l&apos;account.
      </p>

      <Button
        variant="gold"
        onClick={submit}
        disabled={add.isPending || !email.trim() || venueIds.length === 0}
      >
        {add.isPending ? "Invio…" : "Invita"}
      </Button>
    </Card>
  );
}

/**
 * I collaboratori del titolare, dalla scrivania.
 *
 * Stessa feature dell'app (`src/features/team`), stessa tabella, stessi
 * permessi: qui cambia solo che i permessi si spuntano invece di scorrere, e che
 * con una tastiera davanti invitare tre persone è questione di un minuto.
 *
 * ⚠️ Solo il titolare: un collaboratore viene rimandato alla home. La difesa vera
 * è la RLS su `venue_access` — qui si evita solo una pagina vuota.
 */
export function TeamPage() {
  const { ownerId, isOwner, isLoading } = useOwnerVenues();
  const team = useTeam(isOwner ? (ownerId ?? "") : "");

  if (isLoading) return <Spinner label="Caricamento…" />;
  if (!isOwner) return <Navigate to="/" replace />;
  if (!ownerId) return <NoVenues />;

  const members = team.data ?? [];

  return (
    <>
      <PageHeader
        title="Collaboratori"
        subtitle="Chi altro gestisce i tuoi locali, e cosa può fare"
      />

      <div className="flex max-w-2xl flex-col gap-6">
        <InviteForm ownerId={ownerId} />

        {team.isPending ? (
          <Spinner label="Caricamento…" />
        ) : team.isError ? (
          <QueryError error={team.error} />
        ) : members.length === 0 ? (
          <Placeholder
            title="Nessun collaboratore"
            detail="Invita chi organizza i turni con te: sceglierai su quali sedi entra e cosa può fare."
          />
        ) : (
          members.map((m) => (
            <MemberCard key={m.userId ?? m.email ?? m.rows[0].id} member={m} />
          ))
        )}
      </div>
    </>
  );
}
