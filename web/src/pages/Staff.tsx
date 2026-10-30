import { ListSkeleton } from "../ui/Skeleton";
import { PersonAvatar } from "../ui/PersonAvatar";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { operationsGate } from "@/features/workspace/access";
import { useOwnerPeople } from "@/features/staff/hooks";
import {
  personEmploymentType,
  personRoleNames,
  personVenueNames,
} from "@/features/staff/api";
import { useSelfStaff } from "@/features/staff/self";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { NoVenues } from "../venues/NoVenues";
import { RunOnMount } from "../ui/RunOnMount";
import { AddStaffPanel } from "../staff/AddStaffPanel";
import { StaffDetail } from "../staff/StaffDetail";
import { TeamFiltersBar } from "../staff/TeamFiltersBar";
import {
  NO_TEAM_FILTERS,
  TEAM_FILTERS_FROM,
  isNotInApp,
  matchesTeamFilters,
  teamRoleOptions,
  type TeamFilters,
} from "@/features/staff/teamFilters";
import {
  Button,
  Card,
  PageHeader,
  Pill,
  Placeholder,
  QueryError,
} from "../ui/primitives";

/**
 * Il team dell'**azienda**: una riga per persona, non una per sua scheda di
 * sede.
 *
 * Fino al 14/09/2026 elencava le schede della sede attiva, e chi lavorava in tre
 * sedi ci compariva tre volte con un «anche a…» a rimediare. Il team è del
 * titolare — lo dice il database da quando esiste `staff_people` — e ora lo dice
 * anche questa pagina: le sedi sono le etichette della persona.
 */
export function StaffPage() {
  const { ownerId, venues, isMultiVenue, canAny, canUseOperations, access, accessPending, isOwner } =
    useOwnerVenues();
  // Un collaboratore può essere entrato per i soli turni: i pulsanti che
  // porterebbero a una schermata vuota non compaiono.
  const canStaff = canAny("can_manage_staff");
  const canVenue = canAny("can_manage_venue");
  const { data, isPending, isError, error } = useOwnerPeople(ownerId);
  // Chi gestisce può lavorare: la propria riga si riconosce, e finché non c'è
  // si offre di crearla. Stessa query dell'elenco, nessuna in più.
  const self = useSelfStaff();
  // `?aggiungi=1` / `?aggiungi=me` arrivano dalla checklist «Primi passi»:
  // la pagina si apre col pannello già aperto, poi il parametro sparisce.
  const [params, setParams] = useSearchParams();
  const addParam = params.get("aggiungi");
  const [adding, setAdding] = useState(false);
  /** Il pannello «+ Aggiungi» aperto in modalità «sono io». */
  const [addingSelf, setAddingSelf] = useState(false);
  // Si aspetta lo stato dell'azienda: prima, «non operativa» vorrebbe dire solo
  // «non ancora caricata», e il collegamento andrebbe perso.
  const openFromLink = addParam !== null && !accessPending;
  const consumeLink = () => {
    if (canStaff && canUseOperations) {
      setAddingSelf(addParam === "me");
      setAdding(true);
    }
    setParams({}, { replace: true });
  };
  const locked = operationsGate(access, { isOwner });
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [filters, setFilters] = useState<TeamFilters>(NO_TEAM_FILTERS);

  if (venues.length === 0) {
    return (
      <>
        <PageHeader title="Team" />
        <NoVenues detail="Ti serve una sede prima di creare il tuo team." />
      </>
    );
  }

  if (isPending) {
    return (
      <>
        <PageHeader title="Team" />
        <ListSkeleton avatar label="Caricamento team…" />
      </>
    );
  }
  if (isError) return <QueryError error={error} />;

  const people = data ?? [];
  // Una persona con un invito in sospeso in una sede qualunque: è una cosa da
  // fare, e non importa dove.
  const pending = people.filter((p) =>
    p.memberships.some((m) => m.link_status === "pending")
  ).length;
  // Filtri solo da un team abbastanza grande: sotto si legge a colpo d'occhio.
  const showFilters = people.length >= TEAM_FILTERS_FROM;
  const shown = showFilters ? people.filter((p) => matchesTeamFilters(p, filters)) : people;

  return (
    <>
      {openFromLink ? <RunOnMount run={consumeLink} /> : null}
      <PageHeader
        title="Team"
        subtitle={[
          `${people.length} nel tuo team`,
          isMultiVenue ? `${venues.length} sedi` : null,
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
            {/* Anche chi organizza i turni li lavora: finché non ha una scheda
                le sue ore non entrano in nessun conto. Sparisce appena c'è. */}
            {canStaff && canUseOperations && !self.hasCard ? (
              <Button
                onClick={() => {
                  setAddingSelf(true);
                  setAdding(true);
                }}
              >
                + Metti te stesso
              </Button>
            ) : null}
            {canStaff && canUseOperations ? (
              <Button
                variant="gold"
                onClick={() => {
                  setAddingSelf(false);
                  setAdding((v) => !v);
                }}
              >
                {adding && !addingSelf ? "Annulla" : "+ Aggiungi"}
              </Button>
            ) : canStaff && !locked.allowed ? (
              // Spento ma visibile, col perché: il banner in alto ha il bottone
              // per sbloccarlo.
              <Button variant="gold" disabled title={locked.reason}>
                + Aggiungi
              </Button>
            ) : null}
          </div>
        }
      />

      {adding ? (
        <AddStaffPanel
          self={addingSelf}
          onClose={() => {
            setAdding(false);
            setAddingSelf(false);
          }}
        />
      ) : null}

      {people.length === 0 && !adding ? (
        <Placeholder
          title="Nessuno nel tuo team"
          detail="Aggiungi le persone che lavorano per te: potrai assegnarle ai turni e tenere il conto delle ore."
        />
      ) : (
        <>
        {showFilters ? (
          <TeamFiltersBar
            value={filters}
            onChange={setFilters}
            venues={venues.filter((v) => !v.closed_at)}
            roles={teamRoleOptions(people)}
            notInAppCount={people.filter(isNotInApp).length}
          />
        ) : null}
        {shown.length === 0 && people.length > 0 ? (
          <Placeholder
            title="Nessuno corrisponde ai filtri"
            detail="Cambia la ricerca o togli un filtro."
          />
        ) : null}
        <div className="flex flex-col gap-2">
          {shown.map((person) => {
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
                  <PersonAvatar personId={person.id} name={person.full_name} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-t1">
                      {person.full_name}
                      {self.isSelf(person.waiter_id) ? (
                        <span className="ml-1.5 text-xs font-normal text-gold">
                          (tu)
                        </span>
                      ) : null}
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
        </>
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
