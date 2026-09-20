import type { VenueRole } from "@/features/roles/api";
import {
  useArchiveVenueRole,
  useCreateVenueRole,
  useRenameVenueRole,
  useVenueRoles,
} from "@/features/roles/hooks";
import { SUGGESTED_ROLES } from "@/features/staff/roles";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useLastVenue } from "@/features/venues/useLastVenue";
import { userErrorMessage } from "@/lib/errors";
import { useState } from "react";
import { useToast } from "../ui/Toast";
import {
  Button,
  Card,
  Input,
  PageHeader,
  Placeholder,
  QueryError,
  Select,
  Spinner,
} from "../ui/primitives";
import { NoVenues } from "../venues/NoVenues";

/** Una riga: nome modificabile in linea + elimina (archivia). */
function RoleRow({ role }: { role: VenueRole }) {
  const toast = useToast();
  const rename = useRenameVenueRole();
  const archive = useArchiveVenueRole();
  const [name, setName] = useState(role.name);
  const [confirming, setConfirming] = useState(false);

  function save() {
    const next = name.trim();
    if (!next || next === role.name) {
      setName(role.name);
      return;
    }
    rename.mutate(
      { id: role.id, name: next },
      {
        onError: () => {
          setName(role.name);
          toast.show("Nome già usato o non valido.", "error");
        },
      },
    );
  }

  return (
    <Card className="flex items-center justify-between gap-3 p-3">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setName(role.name);
        }}
        className="max-w-xs"
      />
      {confirming ? (
        <span className="flex items-center gap-2">
          <span className="text-xs text-t4">
            I turni passati continueranno a mostrarlo.
          </span>
          <Button
            variant="danger"
            disabled={archive.isPending}
            onClick={() =>
              archive.mutate(role.id, {
                onSuccess: () => toast.show("Ruolo eliminato"),
                onError: (e) => toast.show(userErrorMessage(e), "error"),
              })
            }
          >
            Elimina
          </Button>
          <Button onClick={() => setConfirming(false)}>Annulla</Button>
        </span>
      ) : (
        <Button onClick={() => setConfirming(true)}>Elimina</Button>
      )}
    </Card>
  );
}

/**
 * I ruoli di una sede. Era una lista fissa uguale per tutti: un hotel non ha un
 * sommelier e una discoteca ha il PR, quindi ora la scrive chi gestisce.
 *
 * I ruoli restano **per sede** (`venue_roles.venue_id`), e la sede attiva non
 * esiste più: va chiesta qui. Un selettore in cima e non una sezione per sede
 * tutta in pagina — i nomi si ripetono quasi identici fra sedi, e il campo
 * «Aggiungi un ruolo» dovrebbe comunque sapere a quale sezione appartiene:
 * sarebbe lo stesso selettore, ma nascosto.
 */
export function RuoliPage() {
  const { venues, venuesWith, venueById } = useOwnerVenues();
  // Le mansioni sono un dato della sede: si scrivono dove si ha
  // `can_manage_venue` (policy `venue_roles: owner all`, che passa da
  // `my_venue_ids('venue')`). Le altre sedi non entrano nel selettore, come nel
  // `VenuePicker` dell'app — e `useLastVenue`, che cade su `venues[0]`, può
  // proporne una che non è di questo elenco.
  const editable = venuesWith("can_manage_venue");
  const { venueId: lastVenueId, choose } = useLastVenue();
  const venueId = editable.some((v) => v.id === lastVenueId)
    ? lastVenueId
    : editable[0]?.id;
  const venue = venueId ? venueById(venueId) : undefined;
  const toast = useToast();
  const { data, isPending, isError, error } = useVenueRoles(venueId);
  const create = useCreateVenueRole();
  const [draft, setDraft] = useState("");

  function add(name: string) {
    if (!venueId || !name.trim()) return;
    create.mutate(
      { venueId, name },
      {
        onSuccess: () => setDraft(""),
        onError: () => toast.show("Ruolo già presente o non valido.", "error"),
      },
    );
  }

  if (venues.length === 0) {
    return (
      <>
        <PageHeader title="Ruoli" />
        <NoVenues detail="Ti serve una sede prima di definirne i ruoli." />
      </>
    );
  }

  if (editable.length === 0) {
    return (
      <>
        <PageHeader title="Ruoli" />
        <Placeholder
          title="Non puoi modificare le mansioni"
          detail="Le mansioni fanno parte dei dati della sede: servono i permessi «Dati della sede»."
        />
      </>
    );
  }

  if (isPending) return <Spinner />;
  if (isError) return <QueryError error={error} />;

  const roles = data ?? [];

  // I suggerimenti spariscono man mano che la lista si riempie: servono a chi
  // parte da zero, non a chi ha già deciso come chiamare le proprie mansioni.
  const taken = new Set(roles.map((r) => r.name.trim().toLowerCase()));
  const suggestions = SUGGESTED_ROLES.filter(
    (s) => !taken.has(s.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Ruoli"
        subtitle={
          editable.length > 1 && venue
            ? `Le mansioni di ${venue.name}: ogni sede ha le sue.`
            : "Le mansioni che assegni allo staff e che chiedi sui turni."
        }
        actions={
          editable.length > 1 ? (
            <Select
              value={venueId ?? ""}
              onChange={(e) => choose(e.target.value)}
              className="w-56"
              aria-label="Ruoli di quale sede"
            >
              {editable.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          ) : undefined
        }
      />

      <Card className="flex flex-wrap items-center gap-2 p-3 mb-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add(draft);
          }}
          placeholder="Es. Pizzaiolo"
          className="max-w-xs"
        />
        <Button
          variant="gold"
          disabled={create.isPending || !draft.trim()}
          onClick={() => add(draft)}
        >
          Aggiungi
        </Button>
        {suggestions.length > 0 ? (
          <span className="ml-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-t4">Esempi:</span>
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => add(s)}
                className="focus-gold rounded-full border border-border-2 px-2.5 py-0.5 text-xs text-t3 transition hover:bg-bg-2"
              >
                + {s}
              </button>
            ))}
          </span>
        ) : null}
      </Card>

      {roles.length === 0 ? (
        <Placeholder
          title="Nessun ruolo"
          detail="Aggiungi le mansioni della tua sede: potrai assegnarle allo staff e chiederle sui turni."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {roles.map((r) => (
            <RoleRow key={r.id} role={r} />
          ))}
        </div>
      )}
    </>
  );
}
