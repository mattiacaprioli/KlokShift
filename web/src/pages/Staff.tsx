import { useState } from "react";
import { Link } from "react-router-dom";
import { useOwnerPeople, useVenueStaff } from "@/features/staff/hooks";
import { otherVenueNames, staffRoleNames } from "@/features/staff/api";
import { useVenue } from "../lib/venue";
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
 * L'organico della **sede attiva** — è quello che serve per programmare i suoi
 * turni — con l'indicazione di chi lavora anche altrove.
 *
 * Non è la lista dell'azienda di proposito: quando apri il planning di Milano non
 * ti serve chi lavora solo a Roma. Il conteggio in testa dice però quante persone
 * hai in tutto, perché un titolare con tre sedi deve poterlo sapere da qui.
 */
export function StaffPage() {
  const venue = useVenue();
  const { data, isPending, isError, error } = useVenueStaff(venue.id);
  // Già in cache quasi sempre (la usano AddStaffPanel e il selettore della chat):
  // nella pratica è zero latenza, e porta gratis il conteggio dell'azienda.
  const people = useOwnerPeople(venue.owner_id).data ?? [];
  const [adding, setAdding] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);

  if (isPending) return <Spinner />;
  if (isError) return <QueryError error={error} />;

  const staff = data ?? [];
  const pending = staff.filter((s) => s.link_status === "pending").length;
  const byPerson = new Map(people.map((p) => [p.id, p]));
  // Con una sede sola i due numeri coincidono e il sottotitolo resta quello di
  // prima: chi ha un locale solo non deve accorgersi del multi-sede.
  const inCompany = people.length > staff.length ? people.length : null;

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle={[
          inCompany
            ? `${staff.length} in questa sede · ${inCompany} nell'azienda`
            : `${staff.length} nel tuo organico`,
          pending > 0 ? `${pending} in attesa di risposta` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex gap-2">
            <Link to="/ruoli">
              <Button>Ruoli del locale</Button>
            </Link>
            <Button variant="gold" onClick={() => setAdding((v) => !v)}>
              {adding ? "Annulla" : "+ Aggiungi"}
            </Button>
          </div>
        }
      />

      {adding ? <AddStaffPanel onClose={() => setAdding(false)} /> : null}

      {staff.length === 0 && !adding ? (
        <Placeholder
          title="Nessuno nel tuo organico"
          detail="Aggiungi le persone che lavorano nel locale: potrai assegnarle ai turni e tenere il conto delle ore."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {staff.map((member) => {
            const alsoAt = otherVenueNames(
              byPerson.get(member.person_id),
              venue.id
            );
            return (
            <Card
              key={member.id}
              className="flex cursor-pointer flex-wrap items-center gap-4 p-4 transition hover:border-border-gold"
              // La riga intera apre la scheda: da scrivania è il gesto atteso.
            >
              <button
                onClick={() => setSelectedPersonId(member.person_id)}
                className="focus-gold flex min-w-0 flex-1 items-center gap-4 text-left"
              >
                <span className="min-w-40 flex-1">
                  <span className="block truncate text-sm font-semibold text-t1">
                    {member.display_name}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-t4">
                    {staffRoleNames(member) ?? "Ruoli non indicati"}
                    {member.phone ? ` · ${member.phone}` : ""}
                  </span>
                </span>

                {alsoAt.length > 0 ? (
                  <Pill tone="neutral">anche a {alsoAt.join(", ")}</Pill>
                ) : null}

                <Pill tone="neutral">
                  {member.employment_type === "fisso" ? "Fisso" : "A chiamata"}
                </Pill>

                {member.link_status === "pending" ? (
                  <Pill tone="warning">Invito in attesa</Pill>
                ) : member.waiter ? (
                  <Pill tone="success">Collegato</Pill>
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
