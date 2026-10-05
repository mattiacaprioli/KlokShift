import { ListSkeleton } from "../ui/Skeleton";
import { useMemo, useState, type ReactNode } from "react";
import { COMPANY_ABSENCES_DAYS_BACK } from "@/features/absences/api";
import {
  NO_ABSENCE_FILTERS,
  absencePeopleOf,
  activeAbsenceFilterCount,
  filterCompanyAbsences,
  memberIdsInVenue,
  toggleAbsenceKind,
  type CompanyAbsenceFilters,
} from "@/features/absences/filters";
import { useCompanyAbsences } from "@/features/absences/hooks";
import { ABSENCE_KINDS, groupCompanyAbsences } from "@/features/absences/labels";
import { useOwnerPeople } from "@/features/staff/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { cn } from "@/lib/cn";
import { AbsenceRow, AbsenceRows } from "../absences/AbsencesPanel";
import {
  Button,
  PageHeader,
  Placeholder,
  QueryError,
  Select,
} from "../ui/primitives";

/**
 * Ferie, permessi e malattie di tutta l'azienda: da decidere, in corso e
 * prossime, passate da poco. Lo storico intero di una persona sta nella sua
 * scheda in Staff.
 *
 * ⚠️ Gemello app in `src/app/(manager)/assenze.tsx`.
 */
export function AssenzePage() {
  const { canAny, ownerId, venues, isMultiVenue } = useOwnerVenues();
  const canStaff = canAny("can_manage_staff");
  const query = useCompanyAbsences(canStaff);
  const [filters, setFilters] = useState<CompanyAbsenceFilters>(NO_ABSENCE_FILTERS);
  // L'organico serve solo per il filtro per sede.
  const people = useOwnerPeople(isMultiVenue && canStaff ? ownerId : undefined).data;

  const rows = query.data;
  const personOptions = useMemo(() => absencePeopleOf(rows ?? []), [rows]);
  const venueMemberIds = useMemo(
    () =>
      filters.venueId && people
        ? memberIdsInVenue(people, filters.venueId)
        : null,
    [people, filters.venueId]
  );
  const visible = useMemo(
    () => filterCompanyAbsences(rows ?? [], filters, venueMemberIds),
    [rows, filters, venueMemberIds]
  );
  const { pending, upcoming, closed } = useMemo(
    () => groupCompanyAbsences(visible),
    [visible]
  );
  const activeFilters = activeAbsenceFilterCount(filters);

  const subtitle = `Ferie, permessi e malattia di tutto lo staff · ultimi ${COMPANY_ABSENCES_DAYS_BACK} giorni`;

  if (!canStaff) {
    return (
      <>
        <PageHeader title="Assenze" />
        <Placeholder
          title="Non gestisci l'organico"
          detail="Le assenze le vede chi ha il permesso sull'organico. Nel planning trovi comunque chi non è disponibile."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Assenze" subtitle={subtitle} />
      {query.isPending ? (
        <ListSkeleton avatar label="Caricamento assenze…" className="max-w-5xl" />
      ) : query.isError ? (
        <QueryError error={query.error} />
      ) : (rows ?? []).length === 0 ? (
        <Placeholder
          title="Nessuna assenza"
          detail="Le richieste di ferie e permessi arrivano in chat e compaiono qui. Una malattia comunicata a voce la registri dalla scheda della persona, in Staff."
        />
      ) : (
        <div className="flex max-w-5xl flex-col gap-8">
          {/* Una riga sola senza etichette, come la barra della pagina Ore: le
              voci «Tutte le persone», «Tutte le sedi» dicono già cosa sono.
              Niente `items-center`: lo stretch dà a tutto la stessa altezza. */}
          <div className="flex flex-wrap gap-3">
            <div
              role="group"
              aria-label="Tipo di assenza"
              className="flex rounded-xl border border-border-2 bg-bg-1 p-0.5"
            >
              <KindToggle
                on={filters.kinds.length === 0}
                onClick={() => setFilters((f) => ({ ...f, kinds: [] }))}
              >
                Tutte
              </KindToggle>
              {ABSENCE_KINDS.map((k) => (
                <KindToggle
                  key={k.id}
                  on={filters.kinds.includes(k.id)}
                  onClick={() =>
                    setFilters((f) =>
                      toggleAbsenceKind(f, k.id, ABSENCE_KINDS.length)
                    )
                  }
                >
                  {k.label}
                </KindToggle>
              ))}
            </div>

            <Select
              aria-label="Persona"
              value={filters.personId ?? ""}
              onChange={(e) =>
                setFilters((f) => ({ ...f, personId: e.target.value || null }))
              }
              className="w-auto"
            >
              <option value="">Tutte le persone</option>
              {personOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>

            {isMultiVenue ? (
              <Select
                aria-label="Sede"
                value={filters.venueId ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, venueId: e.target.value || null }))
                }
                className="w-auto"
              >
                <option value="">Tutte le sedi</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            ) : null}

            {activeFilters > 0 ? (
              <Button onClick={() => setFilters(NO_ABSENCE_FILTERS)}>
                Azzera i filtri
              </Button>
            ) : null}
          </div>

          {visible.length === 0 ? (
            <Placeholder
              title="Nessuna assenza con questi filtri"
              detail={`Negli ultimi ${COMPANY_ABSENCES_DAYS_BACK} giorni non c'è niente che corrisponda. Lo storico completo di una persona è nella sua scheda, in Staff.`}
            />
          ) : (
            <>
              {pending.length > 0 ? (
                <Section title={`Da decidere · ${pending.length}`}>
                  <AbsenceRows>
                    {pending.map((a) => (
                      <AbsenceRow
                        key={a.id}
                        absence={a}
                        personName={a.person?.full_name ?? "Persona"}
                        impliedStatus="pending"
                      />
                    ))}
                  </AbsenceRows>
                </Section>
              ) : null}

              <Section title="In corso e prossime">
                {upcoming.length > 0 ? (
                  <AbsenceRows>
                    {upcoming.map((a) => (
                      <AbsenceRow
                        key={a.id}
                        absence={a}
                        personName={a.person?.full_name ?? "Persona"}
                        impliedStatus="approved"
                      />
                    ))}
                  </AbsenceRows>
                ) : (
                  <p className="text-sm text-t4">
                    Nessuna assenza approvata in arrivo.
                  </p>
                )}
              </Section>

              {closed.length > 0 ? (
                <Section title="Passate e chiuse">
                  {/* Una passata approvata è il caso normale: la pill resta
                      solo per le rifiutate e le ritirate. */}
                  <AbsenceRows>
                    {closed.map((a) => (
                      <AbsenceRow
                        key={a.id}
                        absence={a}
                        personName={a.person?.full_name ?? "Persona"}
                        impliedStatus="approved"
                      />
                    ))}
                  </AbsenceRows>
                </Section>
              ) : null}
            </>
          )}
        </div>
      )}
    </>
  );
}

/** Una voce del gruppo «Tipo»: accesa piena, spenta a filo. */
function KindToggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "focus-gold rounded-[10px] px-3 text-sm transition",
        on ? "bg-bg-3 font-semibold text-t1" : "text-t3 hover:text-t1"
      )}
    >
      {children}
    </button>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-t3">
        {title}
      </h2>
      {children}
    </section>
  );
}
