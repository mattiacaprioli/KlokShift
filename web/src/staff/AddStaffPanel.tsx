import { useState } from "react";
import { userErrorMessage } from "@/lib/errors";
import {
  useAddPersonToVenue,
  useAddStaffToVenue,
  useFindWaiterByEmail,
  useVenueStaff,
} from "@/features/staff/hooks";
import { usePeopleFromOtherVenues } from "@/features/staff/usePeopleFromOtherVenues";
import { useActiveVenue } from "@/features/venues/ActiveVenue";
import { useSetStaffMemberRoles } from "@/features/roles/hooks";
import { RoleCheckboxes } from "./RoleCheckboxes";
import type { WaiterLookup } from "@/features/staff/api";
import type { Enums } from "@/types/database";
import { cn } from "@/lib/cn";
import { useVenue } from "../lib/venue";
import { Button, Card, Field, Input, Pill, Select } from "../ui/primitives";
import { useToast } from "../ui/Toast";

type Mode = "esistente" | "manuale" | "invita";

/**
 * I modi di aggiungere una persona all'organico, come nell'app: una persona che
 * il titolare ha già in un'altra sede, una scheda manuale (per chi non ha un
 * account) o un invito via email a chi è già su topWaitr.
 *
 * Il primo esiste solo per chi ha più di una sede, ed è il primo in elenco perché
 * per un titolare con tre locali è il caso più frequente.
 */
export function AddStaffPanel({ onClose }: { onClose: () => void }) {
  const { venues } = useActiveVenue();
  const multiVenue = venues.length > 1;
  const [mode, setMode] = useState<Mode>(multiVenue ? "esistente" : "manuale");

  return (
    <Card className="mb-5">
      <div className="mb-4 flex gap-2">
        {multiVenue ? (
          <ModeTab
            active={mode === "esistente"}
            onClick={() => setMode("esistente")}
            label="Dalle tue sedi"
          />
        ) : null}
        <ModeTab
          active={mode === "manuale"}
          onClick={() => setMode("manuale")}
          label="Scheda manuale"
        />
        <ModeTab
          active={mode === "invita"}
          onClick={() => setMode("invita")}
          label="Invita via email"
        />
      </div>

      {mode === "esistente" ? <ExistingPersonForm onDone={onClose} /> : null}
      {mode === "manuale" ? <ManualForm onDone={onClose} /> : null}
      {mode === "invita" ? <InviteForm onDone={onClose} /> : null}
    </Card>
  );
}

/**
 * Una persona che il titolare ha in un'altra sede entra qui **senza invito**:
 * l'accordo esiste già e l'account, se c'è, è collegato all'anagrafica. Ruoli e
 * tipo di impiego sono invece di questa sede.
 */
function ExistingPersonForm({ onDone }: { onDone: () => void }) {
  const venue = useVenue();
  const add = useAddPersonToVenue();
  const setRoles = useSetStaffMemberRoles();
  const toast = useToast();
  const reusable = usePeopleFromOtherVenues(venue.owner_id, venue.id);
  const [personId, setPersonId] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [empType, setEmpType] = useState<Enums<"employment_type">>("a_chiamata");

  if (reusable.isPending) {
    return <p className="text-sm text-t3">Caricamento…</p>;
  }

  if (reusable.people.length === 0) {
    return (
      <p className="text-sm text-t3">
        Tutte le persone che hai nelle altre sedi fanno già parte di questo
        organico. Usa <b className="text-t1">Scheda manuale</b> o{" "}
        <b className="text-t1">Invita via email</b> per aggiungerne una nuova.
      </p>
    );
  }

  return (
    <>
      <p className="mb-3 text-xs text-t3">
        Aggiungerle qui non richiede un nuovo invito: anagrafica e documenti
        restano quelli che hai già.
      </p>

      <div className="grid grid-cols-3 items-end gap-3">
        <Field label="Persona">
          <Select
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
          >
            <option value="">Scegli…</option>
            {reusable.people.map(({ person, venuesLabel }) => (
              <option key={person.id} value={person.id}>
                {person.full_name} — {venuesLabel}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Impiego in questa sede">
          <Select
            value={empType}
            onChange={(e) =>
              setEmpType(e.target.value as Enums<"employment_type">)
            }
          >
            <option value="fisso">Fisso</option>
            <option value="a_chiamata">A chiamata</option>
          </Select>
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Ruoli in questa sede">
          <RoleCheckboxes
            venueId={venue.id}
            value={roleIds}
            onChange={setRoleIds}
          />
        </Field>
      </div>

      <div className="mt-4">
        <Button
          variant="gold"
          disabled={!personId || add.isPending}
          onClick={() =>
            add.mutate(
              {
                venue_id: venue.id,
                person_id: personId,
                employment_type: empType,
              },
              {
                onSuccess: (member) =>
                  setRoles.mutate(
                    { staffMemberId: member.id, roleIds },
                    {
                      onSuccess: () => {
                        toast.show("Aggiunto a questa sede");
                        onDone();
                      },
                      onError: (e) => toast.show(userErrorMessage(e), "error"),
                    }
                  ),
                onError: (e) => toast.show(userErrorMessage(e), "error"),
              }
            )
          }
        >
          {add.isPending ? "Aggiunta…" : "Aggiungi a questa sede"}
        </Button>
      </div>
    </>
  );
}

function ModeTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "focus-gold rounded-full px-3 py-1.5 text-xs font-semibold transition",
        active
          ? "bg-gold text-gold-ink"
          : "border border-border-2 bg-bg-1 text-t2 hover:bg-bg-2"
      )}
    >
      {label}
    </button>
  );
}

function ManualForm({ onDone }: { onDone: () => void }) {
  const venue = useVenue();
  const add = useAddStaffToVenue();
  const setRoles = useSetStaffMemberRoles();
  const toast = useToast();
  const [name, setName] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [empType, setEmpType] = useState<Enums<"employment_type">>("a_chiamata");
  const [phone, setPhone] = useState("");

  return (
    <>
      <div className="grid grid-cols-3 items-end gap-3">
        <Field label="Nome">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome e cognome"
          />
        </Field>
        <Field label="Impiego">
          <Select
            value={empType}
            onChange={(e) =>
              setEmpType(e.target.value as Enums<"employment_type">)
            }
          >
            <option value="fisso">Fisso</option>
            <option value="a_chiamata">A chiamata</option>
          </Select>
        </Field>
        <Field label="Telefono">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Ruoli">
          <RoleCheckboxes
            venueId={venue.id}
            value={roleIds}
            onChange={setRoleIds}
          />
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="gold"
          disabled={!name.trim() || add.isPending}
          onClick={() =>
            add.mutate(
              {
                ownerId: venue.owner_id,
                venueId: venue.id,
                fullName: name.trim(),
                employmentType: empType,
                phone: phone.trim() || null,
              },
              {
                // I ruoli vivono in una tabella a parte: servono l'id della
                // scheda, quindi si scrivono subito dopo l'insert.
                onSuccess: (member) =>
                  setRoles.mutate(
                    { staffMemberId: member.id, roleIds },
                    {
                      onSuccess: () => {
                        toast.show("Aggiunto allo staff");
                        onDone();
                      },
                      onError: (e) => toast.show(userErrorMessage(e), "error"),
                    }
                  ),
                onError: (e) => toast.show(userErrorMessage(e), "error"),
              }
            )
          }
        >
          {add.isPending ? "Salvataggio…" : "Aggiungi"}
        </Button>
        <span className="text-xs text-t4">
          Scheda senza account: puoi assegnarla ai turni e contarne le ore, ma la
          persona non riceve notifiche.
        </span>
      </div>
    </>
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const venue = useVenue();
  const find = useFindWaiterByEmail();
  const add = useAddStaffToVenue();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<WaiterLookup | null>(null);
  const [searched, setSearched] = useState(false);
  const [inviteType, setInviteType] =
    useState<Enums<"employment_type">>("fisso");

  const staff = useVenueStaff(venue.id).data ?? [];
  const existing = found
    ? staff.find((s) => s.waiter_id === found.id)
    : undefined;

  // Già nel tuo organico, ma in un'ALTRA sede. Senza questo avviso l'invito
  // partirebbe davvero e creerebbe una seconda scheda della stessa persona —
  // inutile, perché l'accordo con lei esiste già: basta aggiungerla a questa sede.
  const reusable = usePeopleFromOtherVenues(venue.owner_id, venue.id);
  const elsewhere =
    found && !existing
      ? reusable.people.find((r) => r.person.waiter_id === found.id)
      : undefined;

  function onSearch() {
    const e = email.trim();
    if (!e) return;
    find.mutate(e, {
      onSuccess: (res) => {
        setFound(res);
        setSearched(true);
      },
      onError: () => toast.show("Ricerca non riuscita. Riprova.", "error"),
    });
  }

  return (
    <>
      <div className="flex items-end gap-3">
        <Field
          label="Email del professionista"
          hint="Deve corrispondere esattamente a quella del suo account."
        >
          <Input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setSearched(false);
              setFound(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSearch();
            }}
            placeholder="nome@esempio.it"
            className="w-72"
          />
        </Field>
        <Button onClick={onSearch} disabled={!email.trim() || find.isPending}>
          {find.isPending ? "Cerco…" : "Cerca"}
        </Button>
      </div>

      {searched && !found ? (
        <p className="mt-4 text-sm text-t3">
          Nessun account con questa email. Puoi comunque creare una{" "}
          <b className="text-t1">scheda manuale</b>.
        </p>
      ) : null}

      {found ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border-2 bg-bg-1 p-3">
          <div className="min-w-40 flex-1">
            <p className="text-sm font-semibold text-t1">
              {found.full_name ?? "Professionista"}
            </p>
            <p className="mt-0.5 text-xs text-t4">
              {found.city ?? "Città non indicata"}
            </p>
          </div>

          {existing ? (
            <Pill
              tone={existing.link_status === "pending" ? "warning" : "success"}
            >
              {existing.link_status === "pending"
                ? "In attesa di risposta"
                : "Già nel tuo staff"}
            </Pill>
          ) : elsewhere ? (
            <p className="min-w-52 flex-1 text-xs text-t2">
              È già nel tuo organico a{" "}
              <b className="text-t1">{elsewhere.venuesLabel}</b>. Aggiungilo a
              questa sede da <b className="text-t1">Dalle tue sedi</b>: niente
              invito da rifare, e tiene anagrafica e documenti che ha già.
            </p>
          ) : (
            <>
              <Select
                value={inviteType}
                onChange={(e) =>
                  setInviteType(e.target.value as Enums<"employment_type">)
                }
                className="w-36"
                aria-label="Tipo di impiego"
              >
                <option value="fisso">Fisso</option>
                <option value="a_chiamata">A chiamata</option>
              </Select>
              <Button
                variant="gold"
                disabled={add.isPending}
                onClick={() =>
                  add.mutate(
                    {
                      ownerId: venue.owner_id,
                      venueId: venue.id,
                      fullName: found.full_name ?? email.trim(),
                      employmentType: inviteType,
                      waiterId: found.id,
                      linkStatus: "pending",
                    },
                    {
                      onSuccess: () => {
                        toast.show("Richiesta inviata");
                        onDone();
                      },
                      onError: (e) => toast.show(userErrorMessage(e), "error"),
                    }
                  )
                }
              >
                Invia richiesta
              </Button>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
