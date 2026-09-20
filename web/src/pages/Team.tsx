import { useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { cn } from "@/lib/cn";
import { userErrorMessage } from "@/lib/errors";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import {
  TEAM_PERMISSIONS,
  TEAM_PERMISSION_HINT,
  TEAM_PERMISSION_LABEL,
  type TeamMember,
  type TeamPermission,
  type TeamPermissions,
} from "@/features/team/api";
import {
  useAddTeamMember,
  useRevokeTeamAccess,
  useSendTeamInvite,
  useSetTeamAccess,
  useTeam,
} from "@/features/team/hooks";
import type { VenueScope } from "@/features/workspace/types";
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

/**
 * Cosa può fare e dove, per un collaboratore.
 *
 * ⚠️ I permessi stanno **sulla persona**, non sulla sede. Prima erano una riga
 * per (persona, sede) e si potevano dare mestieri diversi in sedi diverse: in
 * pratica non succedeva mai, e ogni regola del database doveva chiedersi «su
 * quale sede?» anche quando la risposta era sempre la stessa.
 */
function AccessBlock({ member }: { member: TeamMember }) {
  const toast = useToast();
  const { venues } = useOwnerVenues();
  const save = useSetTeamAccess();
  const revoke = useRevokeTeamAccess();
  const [confirming, setConfirming] = useState(false);

  /** Un cambio per volta: la RPC vuole permessi e ambito insieme. */
  function apply(next: {
    permissions?: TeamPermissions;
    scope?: VenueScope;
    venueIds?: string[];
  }) {
    save.mutate(
      {
        memberId: member.memberId,
        permissions: next.permissions ?? member.permissions,
        scope: next.scope ?? member.scope,
        venueIds: next.venueIds ?? member.venueIds,
      },
      { onError: (e) => toast.show(userErrorMessage(e), "error") }
    );
  }

  return (
    <div className="flex flex-col gap-4 border-t border-border px-5 py-4">
      <Group label="Cosa può fare">
        <PermissionToggles
          value={member.permissions}
          disabled={save.isPending}
          onChange={(perm, on) =>
            apply({ permissions: { ...member.permissions, [perm]: on } })
          }
        />
      </Group>

      <Group label="Dove">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={member.scope === "all"}
            onClick={() =>
              apply(
                member.scope === "all"
                  ? { scope: "selected", venueIds: [] }
                  : { scope: "all" }
              )
            }
            className={cn(
              "focus-gold rounded-full px-3 py-1.5 text-xs font-medium transition",
              member.scope === "all"
                ? "bg-gold text-gold-ink"
                : "border border-border-2 bg-bg-1 text-t2 hover:bg-bg-2"
            )}
          >
            Tutte le sedi
          </button>
          {member.scope === "selected"
            ? venues.map((v) => {
                const on = member.venueIds.includes(v.id);
                return (
                  <button
                    key={v.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      apply({
                        scope: "selected",
                        venueIds: on
                          ? member.venueIds.filter((id) => id !== v.id)
                          : [...member.venueIds, v.id],
                      })
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
              })
            : null}
        </div>
        {member.scope === "all" ? (
          <span className="text-[11px] text-t4">
            Comprende anche le sedi che aprirai in futuro.
          </span>
        ) : null}
      </Group>

      <div className="flex justify-end">
        {confirming ? (
          <span className="flex items-center gap-2">
            <span className="text-xs text-t3">Togliere l&apos;accesso?</span>
            <Button className="px-3 py-1.5 text-xs" onClick={() => setConfirming(false)}>
              Annulla
            </Button>
            <Button
              variant="danger"
              className="px-3 py-1.5 text-xs"
              disabled={revoke.isPending}
              onClick={() =>
                revoke.mutate(member.memberId, {
                  onSuccess: () => {
                    setConfirming(false);
                    toast.show("Accesso revocato");
                  },
                  onError: (e) => toast.show(userErrorMessage(e), "error"),
                })
              }
            >
              Conferma
            </Button>
          </span>
        ) : (
          <Button
            variant="ghost"
            className="px-3 py-1.5 text-xs"
            onClick={() => setConfirming(true)}
          >
            Togli l&apos;accesso
          </Button>
        )}
      </div>
    </div>
  );
}

function MemberCard({ member }: { member: TeamMember }) {
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
              crea aprendo il link, chi ce l'ha già accetta l'invito dall'app.
              Nominarne una sola fa sembrare l'invito rotto all'altra metà. */}
          <p className="flex-1 text-xs leading-relaxed text-t2">
            Se non aveva un account, lo crea aprendo il link che gli abbiamo
            mandato e scegliendo una password. Se ce l&apos;aveva già, trova
            l&apos;invito da accettare quando entra.
          </p>
          <Button
            className="shrink-0 px-3 py-1.5 text-xs"
            disabled={invite.isPending}
            onClick={() =>
              invite.mutate(member.memberId, {
                onSuccess: () => toast.show("Invito spedito"),
                onError: (e) => toast.show(userErrorMessage(e), "error"),
              })
            }
          >
            Reinvia
          </Button>
        </div>
      ) : null}

      <AccessBlock member={member} />
    </Card>
  );
}

/** Il modulo d'invito: email, sedi, permessi. */
function InviteForm({ workspaceId }: { workspaceId: string }) {
  const toast = useToast();
  const { venues, isMultiVenue } = useOwnerVenues();
  const add = useAddTeamMember();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  /** Vuoto = tutte le sedi, anche quelle future. */
  const [picked, setPicked] = useState<string[]>([]);
  const [permissions, setPermissions] =
    useState<TeamPermissions>(DEFAULT_PERMISSIONS);

  // Con una sede sola la domanda non si pone, e l'ambito resta «tutte»: così
  // una sede aperta domani non lo lascia fuori.
  const allVenues = !isMultiVenue || picked.length === 0;

  function submit() {
    if (!fullName.trim() || !email.trim()) return;
    add.mutate(
      {
        workspaceId,
        fullName: fullName.trim(),
        email: email.trim(),
        permissions,
        scope: allVenues ? "all" : "selected",
        venueIds: picked,
      },
      {
        onSuccess: (res) => {
          if (res.kind === "already") {
            toast.show("Collabora già alla gestione.", "error");
            return;
          }
          toast.show(
            res.kind === "invited_in_app"
              ? "Invito mandato: lo accetta dall'app"
              : res.emailSent
                ? "Invito spedito"
                : res.emailError
                  ? `Invito creato · email non spedita: ${res.emailError}`
                  : "Invito creato · email non spedita, riprova dalla lista"
          );
          setFullName("");
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
          Se ha già un account, trova l&apos;invito da accettare quando entra.
          Altrimenti gli mandiamo un link: lo apre, sceglie una password ed è
          dentro, senza registrarsi. Finché non lo apre non esiste nessun
          account.
        </p>
      </div>

      <Field label="Nome e cognome">
        <Input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Come lo chiami tu"
        />
      </Field>

      <Field label="Email">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nome@email.com"
        />
      </Field>

      {isMultiVenue ? (
        <Group label="Dove">
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
          <span className="text-[11px] text-t4">
            {allVenues
              ? "Nessuna scelta: vale su tutte le sedi, anche quelle che aprirai."
              : "Vale solo sulle sedi scelte."}
          </span>
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
          disabled={add.isPending || !fullName.trim() || !email.trim()}
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
 * è il DB, che lascia `set_member_access` al solo titolare — qui si evita solo
 * una pagina vuota.
 */
export function TeamPage() {
  const { workspaceId, isOwner, isLoading } = useOwnerVenues();
  const team = useTeam(isOwner ? (workspaceId ?? "") : "");

  if (isLoading) return <Spinner label="Caricamento…" />;
  if (!isOwner) return <Navigate to="/" replace />;
  if (!workspaceId) return <NoVenues />;

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
              detail="Invita chi organizza i turni con te: sceglierai cosa può fare e su quali sedi."
            />
          ) : (
            members.map((m) => <MemberCard key={m.memberId} member={m} />)
          )}
        </section>

        <aside className="xl:sticky xl:top-8">
          <InviteForm workspaceId={workspaceId} />
        </aside>
      </div>
    </>
  );
}
