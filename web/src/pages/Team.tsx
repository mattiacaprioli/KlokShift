import { useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { cn } from "@/lib/cn";
import { userErrorMessage } from "@/lib/errors";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import {
  permissionsForNewVenue,
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
  useAddTeamVenue,
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

export const DEFAULT_PERMISSIONS: TeamPermissions = {
  can_manage_shifts: true,
  can_manage_staff: false,
  can_view_hours: false,
  can_manage_documents: false,
  can_manage_venue: false,
};

/** Etichetta di gruppo con lo stile di `Field`, ma senza `<label>`: dentro ci
 *  sono altri controlli, e un'etichetta che ne avvolge più d'uno attiva il
 *  primo a ogni clic sul titolo. */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-t3">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * Una riga per area di permesso, con descrizione e interruttore.
 *
 * Esportata perché la riusa `staff/PromoteSection.tsx`: la promozione di un
 * membro dell'organico (F3) chiede esattamente le stesse cinque cose, e due
 * copie divergerebbero alla prima area aggiunta.
 */
export function PermissionChecks({
  value,
  onChange,
  disabled,
}: {
  value: TeamPermissions;
  onChange: (perm: TeamPermission, next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border-2">
      {TEAM_PERMISSIONS.map((perm) => (
        <label
          key={perm}
          className="flex cursor-pointer items-center gap-4 px-4 py-3 transition hover:bg-bg-2/50 has-disabled:cursor-not-allowed"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-t1">
              {TEAM_PERMISSION_LABEL[perm]}
            </span>
            <span className="mt-0.5 block text-xs text-t3">
              {TEAM_PERMISSION_HINT[perm]}
            </span>
          </span>
          <input
            type="checkbox"
            className="peer sr-only"
            checked={value[perm]}
            disabled={disabled}
            onChange={(e) => onChange(perm, e.target.checked)}
          />
          {/* L'interruttore è solo disegno: lo stato vero è la checkbox qui
              sopra, che resta quella che legge lo screen reader. */}
          <span
            aria-hidden
            className="relative h-5 w-9 shrink-0 rounded-full bg-bg-3 transition peer-checked:bg-gold peer-focus-visible:ring-2 peer-focus-visible:ring-gold/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bg-card peer-disabled:opacity-60 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-t3 after:transition peer-checked:after:translate-x-4 peer-checked:after:bg-gold-ink"
          />
        </label>
      ))}
    </div>
  );
}

/**
 * I permessi già dati, in forma compatta: una pastiglia per area, accesa o no.
 * La descrizione sta nel tooltip — chi arriva qui l'ha già letta nell'invito, e
 * cinque righe per ogni sede di ogni collaboratore facevano della lista un
 * modulo.
 */
function PermissionToggles({
  value,
  onChange,
  disabled,
}: {
  value: TeamPermissions;
  onChange: (perm: TeamPermission, next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {TEAM_PERMISSIONS.map((perm) => {
        const on = value[perm];
        return (
          <button
            key={perm}
            type="button"
            aria-pressed={on}
            title={TEAM_PERMISSION_HINT[perm]}
            disabled={disabled}
            onClick={() => onChange(perm, !on)}
            className={cn(
              "focus-gold inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-wait disabled:opacity-70",
              on
                ? "border-gold/40 bg-gold/15 text-gold hover:bg-gold/25"
                : "border-border-2 text-t3 hover:bg-bg-2 hover:text-t2"
            )}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              {on ? <path d="M2.5 6.2 5 8.5l4.5-5" /> : <path d="M6 2.5v7M2.5 6h7" />}
            </svg>
            {TEAM_PERMISSION_LABEL[perm]}
          </button>
        );
      })}
    </div>
  );
}

/** Una sede di un collaboratore, con i suoi permessi. */
function VenueAccessRow({ row }: { row: VenueAccess }) {
  const toast = useToast();
  const { venueById } = useOwnerVenues();
  const update = useUpdateTeamPermissions();
  const revoke = useRevokeTeamAccess();
  const [confirming, setConfirming] = useState(false);

  const name = venueById(row.venue_id)?.name ?? "Sede";

  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <span className="truncate text-xs font-semibold uppercase tracking-wider text-t3">
          {name}
        </span>
        {confirming ? (
          <span className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-t3">Togliere l&apos;accesso?</span>
            <Button
              className="px-3 py-1 text-xs"
              onClick={() => setConfirming(false)}
            >
              Annulla
            </Button>
            <Button
              variant="danger"
              className="px-3 py-1 text-xs"
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
          // Un'azione rara e distruttiva: presente, ma senza il peso di un
          // pulsante accanto a ogni sede.
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="focus-gold shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-t4 transition hover:bg-error/10 hover:text-error"
          >
            Togli l&apos;accesso
          </button>
        )}
      </div>
      <PermissionToggles
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

/**
 * Le sedi che il collaboratore non ha ancora, da dargli senza ripassare dal
 * modulo d'invito — che lo faceva già, ma nessuno pensa di "invitare" chi è
 * attivo da una settimana.
 *
 * Un clic sulla sede non basta a dare l'accesso: apre la sezione come sarà, con
 * i permessi da confermare. Si sta aprendo la gestione di una sede a qualcuno, e
 * i permessi vanno visti prima, non corretti dopo.
 *
 * Con un invito ancora in sospeso la riga nuova resta `pending` come le altre e
 * non parte una seconda email: si aggancia tutto allo stesso primo accesso.
 */
function AddVenueRow({
  ownerId,
  member,
}: {
  ownerId: string;
  member: TeamMember;
}) {
  const toast = useToast();
  const { venues } = useOwnerVenues();
  const add = useAddTeamVenue(ownerId);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [permissions, setPermissions] =
    useState<TeamPermissions>(DEFAULT_PERMISSIONS);

  const missing = venues.filter((v) => !member.venueIds.includes(v.id));
  if (missing.length === 0) return null;

  const picked = missing.find((v) => v.id === pickedId);

  if (!picked) {
    return (
      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <span className="mr-1 text-xs text-t4">Aggiungi una sede</span>
        {missing.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => {
              setPermissions(permissionsForNewVenue(member, DEFAULT_PERMISSIONS));
              setPickedId(v.id);
            }}
            className="focus-gold inline-flex items-center gap-1.5 rounded-full border border-dashed border-border-2 px-3 py-1.5 text-xs font-medium text-t3 transition hover:border-gold/40 hover:text-gold"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 2.5v7M2.5 6h7" />
            </svg>
            {v.name}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 bg-bg-2/30 px-5 py-4">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <span className="truncate text-xs font-semibold uppercase tracking-wider text-t3">
          {picked.name}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Button
            className="px-3 py-1 text-xs"
            disabled={add.isPending}
            onClick={() => setPickedId(null)}
          >
            Annulla
          </Button>
          <Button
            variant="gold"
            className="px-3 py-1 text-xs"
            disabled={add.isPending}
            onClick={() =>
              add.mutate(
                { member, venueId: picked.id, permissions },
                {
                  onSuccess: () => {
                    setPickedId(null);
                    toast.show(
                      member.status === "pending"
                        ? "Sede aggiunta: la vedrà quando accetta l'invito"
                        : `Accesso a ${picked.name} aggiunto`
                    );
                  },
                  onError: (e) => toast.show(userErrorMessage(e), "error"),
                }
              )
            }
          >
            {add.isPending ? "Aggiungo…" : "Aggiungi"}
          </Button>
        </span>
      </div>
      <PermissionToggles
        value={permissions}
        disabled={add.isPending}
        onChange={(perm, next) =>
          setPermissions((prev) => ({ ...prev, [perm]: next }))
        }
      />
    </div>
  );
}

function MemberCard({
  ownerId,
  member,
}: {
  ownerId: string;
  member: TeamMember;
}) {
  const toast = useToast();
  const invite = useSendTeamInvite();
  const pending = member.status === "pending";
  const title = member.fullName?.trim() || member.email || "Collaboratore";
  // Senza nome il titolo è già l'indirizzo: ripeterlo sotto è solo rumore.
  const subtitle = member.fullName?.trim()
    ? (member.email ?? "Account collegato")
    : member.email
      ? null
      : "Account collegato";

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-3 px-5 py-4">
        <Avatar url={member.avatarUrl} name={title} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-t1">{title}</p>
          {subtitle ? (
            <p className="truncate text-xs text-t3">{subtitle}</p>
          ) : null}
        </div>
        {pending ? (
          <Pill tone="warning">Invito mandato</Pill>
        ) : (
          <Pill tone="success">Attivo</Pill>
        )}
      </div>

      {pending ? (
        <div className="mx-5 mb-4 flex items-center gap-4 rounded-xl border border-warning/20 bg-warning/5 px-4 py-3">
          {/* Due strade, e vanno dette tutt'e due: chi non aveva un account lo
              crea aprendo il link, chi ce l'ha già entra al primo accesso dopo
              l'invito (`claimInvites` in lib/auth.tsx). Nominarne una sola —
              com'era fino al 16/09 — fa sembrare l'invito rotto all'altra metà. */}
          <p className="flex-1 text-xs leading-relaxed text-t2">
            Entra aprendo il link che gli abbiamo mandato e scegliendo una
            password: l&apos;account nasce lì. Se ne aveva già uno, gli basta
            rientrare.
          </p>
          <Button
            className="shrink-0 px-3 py-1.5 text-xs"
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

      <div className="divide-y divide-border border-t border-border">
        {member.rows.map((row) => (
          <VenueAccessRow key={row.id} row={row} />
        ))}
        <AddVenueRow ownerId={ownerId} member={member} />
      </div>
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
            toast.show("Ha già accesso a tutte le sedi scelte.", "error");
            return;
          }
          toast.show(
            res.kind === "linked"
              ? `${res.name ?? "Il collaboratore"} ora ha accesso`
              : res.emailSent
                ? "Invito spedito"
                : res.emailError
                  ? `Invito creato · email non spedita: ${res.emailError}`
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
    <Card className="flex flex-col gap-5 p-6">
      <div>
        <div className="mb-3 h-1 w-8 rounded-full bg-gold" />
        <h2 className="font-serif text-xl text-t1">Invita un collaboratore</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-t3">
          Se ha già un account da sede con l&apos;email confermata, l&apos;accesso
          parte subito. Altrimenti gli mandiamo un link: lo apre, sceglie una
          password ed è dentro, senza registrarsi. Finché non lo apre non esiste
          nessun account.
        </p>
      </div>

      <Field label="Email">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nome@email.com"
        />
      </Field>

      {isMultiVenue ? (
        <Group label="Su quali sedi">
          <div className="flex flex-wrap gap-1.5">
            {venues.map((v) => {
              const on = picked.includes(v.id);
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setPicked((prev) =>
                      on ? prev.filter((id) => id !== v.id) : [...prev, v.id]
                    )
                  }
                  className={cn(
                    "focus-gold rounded-full px-3 py-1.5 text-xs font-medium transition",
                    on
                      ? "bg-gold text-gold-ink"
                      : "border border-border-2 bg-bg-1 text-t2 hover:bg-bg-2"
                  )}
                >
                  {v.name}
                </button>
              );
            })}
          </div>
        </Group>
      ) : null}

      <Group label="Cosa può fare">
        <PermissionChecks
          value={permissions}
          onChange={(perm, next) =>
            setPermissions((prev) => ({ ...prev, [perm]: next }))
          }
        />
      </Group>

      <div className="flex flex-col gap-3 border-t border-border pt-5">
        <Button
          variant="gold"
          className="w-full py-2.5"
          onClick={submit}
          disabled={add.isPending || !email.trim() || venueIds.length === 0}
        >
          {add.isPending ? "Invio…" : "Invita"}
        </Button>
        <p className="text-center text-[11px] leading-relaxed text-t4">
          Restano tuoi: aprire e chiudere sedi, invitare altri collaboratori e
          l&apos;account.
        </p>
      </div>
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
 * Due colonne da `xl`: la lista è quella che si torna a guardare, l'invito resta
 * a portata accanto. Sotto quella larghezza la colonna dell'invito lascerebbe
 * alla lista meno spazio di quanto chiedono le pastiglie dei permessi.
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
  const pendingCount = members.filter((m) => m.status === "pending").length;

  return (
    <>
      <PageHeader
        title="Collaboratori"
        // I conteggi quando c'è qualcuno da contare, come in Staff; stanno qui
        // e non in testa alla lista perché le due colonne partano alla pari.
        subtitle={
          members.length > 0
            ? [
                members.length === 1
                  ? "1 collaboratore"
                  : `${members.length} collaboratori`,
                pendingCount > 0 ? `${pendingCount} in attesa di risposta` : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : "Chi altro gestisce le tue sedi, e cosa può fare"
        }
      />

      <div className="grid max-w-6xl items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex min-w-0 flex-col gap-3">
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
              <MemberCard
                key={m.userId ?? m.email ?? m.rows[0].id}
                ownerId={ownerId}
                member={m}
              />
            ))
          )}
        </section>

        <aside className="xl:sticky xl:top-8">
          <InviteForm ownerId={ownerId} />
        </aside>
      </div>
    </>
  );
}
