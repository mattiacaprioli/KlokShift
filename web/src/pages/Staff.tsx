import { useState } from "react";
import { Link } from "react-router-dom";
import { useOwnerPeople } from "@/features/staff/hooks";
import {
  personEmploymentType,
  personRoleNames,
  personVenueNames,
} from "@/features/staff/api";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { NoVenues } from "../venues/NoVenues";
import { AddStaffPanel } from "../staff/AddStaffPanel";
import { StaffDetail } from "../staff/StaffDetail";
import {
  Button,
  Card,
  PageHeader,
  Pill,
  Placeholder,
  QueryError,
  Spinner,
} from "../ui/primitives";

/**
 * L'organico dell'**azienda**: una riga per persona, non una per sua scheda di
 * sede.
 *
 * Fino al 14/09/2026 elencava le schede della sede attiva, e chi lavorava in tre
 * locali ci compariva tre volte con un «anche a…» a rimediare. L'organico è del
 * titolare — lo dice il database da quando esiste `staff_people` — e ora lo dice
 * anche questa pagina: le sedi sono le etichette della persona.
 */
export function StaffPage() {
  const { ownerId, venues, isMultiVenue, canAny } = useOwnerVenues();
  // Un collaboratore può essere entrato per i soli turni: i pulsanti che
  // porterebbero a una schermata vuota non compaiono.
  const canStaff = canAny("can_manage_staff");
  const canVenue = canAny("can_manage_venue");
  const { data, isPending, isError, error } = useOwnerPeople(ownerId);
  const [adding, setAdding] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);

  if (venues.length === 0) {
    return (
      <>
        <PageHeader title="Staff" />
        <NoVenues detail="Ti serve un locale prima di creare il tuo organico." />
      </>
    );
  }

  if (isPending) return <Spinner />;
  if (isError) return <QueryError error={error} />;

  const people = data ?? [];
  // Una persona con un invito in sospeso in una sede qualunque: è una cosa da
  // fare, e non importa dove.
  const pending = people.filter((p) =>
    p.memberships.some((m) => m.link_status === "pending")
  ).length;

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle={[
          `${people.length} nel tuo organico`,
          isMultiVenue ? `${venues.length} locali` : null,
          pending > 0 ? `${pending} in attesa di risposta` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex gap-2">
            {canVenue ? (
              <Link to="/ruoli">
                <Button>Ruoli</Button>
              </Link>
            ) : null}
            {canStaff ? (
              <Button variant="gold" onClick={() => setAdding((v) => !v)}>
                {adding ? "Annulla" : "+ Aggiungi"}
              </Button>
            ) : null}
          </div>
        }
      />

      {adding ? <AddStaffPanel onClose={() => setAdding(false)} /> : null}

      {people.length === 0 && !adding ? (
        <Placeholder
          title="Nessuno nel tuo organico"
          detail="Aggiungi le persone che lavorano per te: potrai assegnarle ai turni e tenere il conto delle ore."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {people.map((person) => {
            const at = isMultiVenue ? personVenueNames(person) : [];
            const employment = personEmploymentType(person);
            const isPending = person.memberships.some(
              (m) => m.link_status === "pending"
            );
            return (
              <Card
                key={person.id}
                className="flex cursor-pointer flex-wrap items-center gap-4 p-4 transition hover:border-border-gold"
                // La riga intera apre la scheda: da scrivania è il gesto atteso.
              >
                <button
                  onClick={() => setSelectedPersonId(person.id)}
                  className="focus-gold flex min-w-0 flex-1 items-center gap-4 text-left"
                >
                  <span className="min-w-40 flex-1">
                    <span className="block truncate text-sm font-semibold text-t1">
                      {person.full_name}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-t4">
                      {personRoleNames(person) ?? "Ruoli non indicati"}
                      {person.phone ? ` · ${person.phone}` : ""}
                    </span>
                  </span>

                  {at.map((name) => (
                    <Pill key={name} tone="neutral">
                      {name}
                    </Pill>
                  ))}

                  {/* Assente quando le sedi non concordano: si può essere fissi
                      a Roma e a chiamata a Milano, e mostrarne uno solo sarebbe
                      una bugia detta con sicurezza. */}
                  {employment ? (
                    <Pill tone="neutral">
                      {employment === "fisso" ? "Fisso" : "A chiamata"}
                    </Pill>
                  ) : null}

                  {isPending ? (
                    <Pill tone="warning">Invito in attesa</Pill>
                  ) : person.waiter ? (
                    <Pill tone="success">Collegato</Pill>
                  ) : person.email ? (
                    // Nessun account ancora, ma l'indirizzo c'è: si sta
                    // aspettando che si registri con quello.
                    <Pill tone="warning">
                      {person.invited_at ? "Invito mandato" : "Da invitare"}
                    </Pill>
                  ) : (
                    <Pill tone="neutral">Scheda</Pill>
                  )}
                </button>
              </Card>
            );
          })}
        </div>
      )}

      {selectedPersonId ? (
        <StaffDetail
          // Rimonta la scheda quando cambi persona: gli stati locali dei campi
          // devono ripartire dai valori di quella nuova.
          key={selectedPersonId}
          personId={selectedPersonId}
          onClose={() => setSelectedPersonId(null)}
        />
      ) : null}
    </>
  );
}
