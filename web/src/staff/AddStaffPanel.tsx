import { useState } from "react";
import { userErrorMessage } from "@/lib/errors";
import {
  useAddStaffToVenues,
  useFindWaiterByEmail,
  useOwnerPeople,
} from "@/features/staff/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useLastVenue } from "@/features/venues/useLastVenue";
import { useSetStaffMemberRoles } from "@/features/roles/hooks";
import { RoleCheckboxes } from "./RoleCheckboxes";
import { personVenueNames, type WaiterLookup } from "@/features/staff/api";
import type { Enums } from "@/types/database";
import { cn } from "@/lib/cn";
import { Button, Card, Field, Input, Select } from "../ui/primitives";
import { useToast } from "../ui/Toast";

type Mode = "manuale" | "invita";

/**
 * Aggiungi una persona all'organico: scheda manuale (per chi non ha un account)
 * o invito via email a chi è già su topWaitr.
 *
 * Dal 14/09/2026 si aggiunge **una persona**, non una sua scheda di sede: prima
 * chi, poi dove. È sparita la modalità «Dalle tue sedi» — esisteva per rimediare
 * al fatto che l'organico era della sede attiva, e riusare qualcuno significava
 * ricopiarlo qui. Ora l'organico è dell'azienda: chi c'è già è già in elenco, e
 * gli si aggiunge una sede dalla sua scheda.
 */
export function AddStaffPanel({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("manuale");

  return (
    <Card className="mb-5">
      <div className="mb-4 flex gap-2">
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

      {mode === "manuale" ? <ManualForm onDone={onClose} /> : null}
      {mode === "invita" ? <InviteForm onDone={onClose} /> : null}
    </Card>
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
        "focus-gold rounded-full px-3 py-1.5 text-xs font-medium transition",
        active
          ? "bg-gold text-gold-ink"
          : "border border-border-2 bg-bg-1 text-t2 hover:bg-bg-2"
      )}
    >
      {label}
    </button>
  );
}

/**
 * In quali sedi lavora. Almeno una; con un locale solo non compare, perché la
 * risposta è già nota.
 *
 * Ritorna anche `single`: l'id quando ne è selezionata **esattamente una**. I
 * ruoli vivono in `venue_roles`, che è per sede, quindi si possono chiedere solo
 * in quel caso — con due o più servirebbero due o più elenchi di caselle.
 */
function useVenueSelection() {
  const { venues, isMultiVenue } = useOwnerVenues();
  const { venueId: lastVenueId } = useLastVenue();
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const value = picked ?? new Set(lastVenueId ? [lastVenueId] : []);

  function toggle(id: string) {
    setPicked(() => {
      const next = new Set(value);
      // L'ultima non si toglie: una persona senza sedi non esiste (il trigger
      // `delete_orphan_staff_person` la cancellerebbe) e il bottone resterebbe
      // disabilitato senza dire perché.
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else next.add(id);
      return next;
    });
  }

  const node = isMultiVenue ? (
    <Field label="In quali sedi">
      <div className="flex flex-wrap gap-1.5">
        {venues.map((v) => {
          const on = value.has(v.id);
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => toggle(v.id)}
              aria-pressed={on}
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
    </Field>
  ) : null;

  return {
    venueIds: [...value],
    single: value.size === 1 ? [...value][0] : undefined,
    node,
  };
}

function ManualForm({ onDone }: { onDone: () => void }) {
  const { ownerId } = useOwnerVenues();
  const add = useAddStaffToVenues();
  const setRoles = useSetStaffMemberRoles();
  const toast = useToast();
  const { venueIds, single, node: venuePicker } = useVenueSelection();
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

      {venuePicker ? <div className="mt-4">{venuePicker}</div> : null}

      <div className="mt-4">
        {single ? (
          <Field label="Ruoli">
            <RoleCheckboxes
              venueId={single}
              value={roleIds}
              onChange={setRoleIds}
            />
          </Field>
        ) : (
          <p className="text-xs text-t3">
            I ruoli cambiano da un locale all&apos;altro: li assegnerai dalla sua
            scheda, sede per sede.
          </p>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="gold"
          disabled={!name.trim() || venueIds.length === 0 || add.isPending}
          onClick={() =>
            add.mutate(
              {
                ownerId: ownerId!,
                venueIds,
                fullName: name.trim(),
                employmentType: empType,
                phone: phone.trim() || null,
              },
              {
                // I ruoli vivono in una tabella a parte: servono l'id della
                // scheda, quindi si scrivono subito dopo l'insert. Solo con una
                // sede sola — altrimenti non sono stati chiesti.
                onSuccess: (members) => {
                  if (!single || roleIds.length === 0 || members.length !== 1) {
                    toast.show(
                      single
                        ? "Aggiunto allo staff"
                        : "Aggiunto allo staff · assegna i ruoli in ogni sede"
                    );
                    onDone();
                    return;
                  }
                  setRoles.mutate(
                    { staffMemberId: members[0].id, roleIds },
                    {
                      onSuccess: () => {
                        toast.show("Aggiunto allo staff");
                        onDone();
                      },
                      onError: (e) => toast.show(userErrorMessage(e), "error"),
                    }
                  );
                },
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
  const { ownerId, isMultiVenue } = useOwnerVenues();
  const find = useFindWaiterByEmail();
  const add = useAddStaffToVenues();
  const toast = useToast();
  const { venueIds, node: venuePicker } = useVenueSelection();
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<WaiterLookup | null>(null);
  const [searched, setSearched] = useState(false);
  const [inviteType, setInviteType] =
    useState<Enums<"employment_type">>("fisso");

  // Già nel tuo organico. Senza questo avviso l'invito partirebbe davvero e
  // creerebbe una seconda scheda della stessa persona — inutile, perché
  // l'accordo con lei esiste già: basta aprirla e aggiungerle la sede.
  const people = useOwnerPeople(ownerId).data ?? [];
  const already = found ? people.find((p) => p.waiter_id === found.id) : undefined;

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
        <div className="mt-4 rounded-xl border border-border-2 bg-bg-1 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-40 flex-1">
              <p className="text-sm font-semibold text-t1">
                {found.full_name ?? "Professionista"}
              </p>
              <p className="mt-0.5 text-xs text-t4">
                {found.city ?? "Città non indicata"}
              </p>
            </div>

            {already ? (
              <p className="min-w-52 flex-1 text-xs text-t2">
                È già nel tuo organico
                {isMultiVenue ? (
                  <>
                    {" "}
                    a{" "}
                    <b className="text-t1">
                      {personVenueNames(already).join(", ")}
                    </b>
                  </>
                ) : null}
                . Aprilo dall&apos;elenco per aggiungergli una sede o cambiargli i
                ruoli: tiene anagrafica e documenti che ha già.
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
                  disabled={add.isPending || venueIds.length === 0}
                  onClick={() =>
                    add.mutate(
                      {
                        ownerId: ownerId!,
                        venueIds,
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

          {!already && venuePicker ? (
            <div className="mt-3">{venuePicker}</div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
