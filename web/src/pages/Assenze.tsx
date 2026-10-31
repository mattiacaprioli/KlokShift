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
import { ABSENCE_KINDS, ABSENCE_KIND_LABEL, groupCompanyAbsences, summarizeCompanyAbsences } from "@/features/absences/labels";
import type { AbsenceWithPerson } from "@/features/absences/api";
import { PersonAvatar } from "../ui/PersonAvatar";
import { useOwnerPeople } from "@/features/staff/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { cn } from "@/lib/cn";
import { AbsenceRow, AbsenceRows } from "../absences/AbsencesPanel";
import { NoVenues } from "../venues/NoVenues";
import {
  Button,
  Card,
  PageColumns,
  PageHeader,
  Placeholder,
  QueryError,
  Select,
} from "../ui/primitives";
import { missingPermission } from "@/features/workspace/permissions";

/**
 * Ferie, permessi e malattie di tutta l'azienda: da decidere, in corso e
 * prossime, passate da poco. Lo storico intero di una persona sta nella sua
 * scheda in Team.
 *
 * ⚠️ Gemello app in `src/app/(manager)/assenze.tsx`.
 */
export function AssenzePage() {
  const { canAny, ownerId, venues, isMultiVenue } = useOwnerVenues();
  const canStaff = canAny("can_manage_staff");
  const query = useCompanyAbsences(canStaff);
  const [filters, setFilters] = useState<CompanyAbsenceFilters>(NO_ABSENCE_FILTERS);
  // Il team serve solo per il filtro per sede.
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

  const subtitle = `Ferie, permessi e malattia di tutto il team · ultimi ${COMPANY_ABSENCES_DAYS_BACK} giorni`;

  if (!canStaff) {
    return (
      <>
        <PageHeader title="Assenze" />
        <Placeholder
          title={missingPermission("can_manage_staff").title}
          detail={`${missingPermission("can_manage_staff").detail} Nei turni vedi comunque chi non è disponibile.`}
        />
      </>
    );
  }

  if (venues.length === 0) {
    return (
      <>
        <PageHeader title="Assenze" />
        <NoVenues detail="Le assenze sono del tuo team: apri una sede per iniziare a crearlo." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Assenze" subtitle={subtitle} />
      {query.isPending ? (
        <ListSkeleton avatar label="Caricamento assenze…" className="max-w-7xl" />
      ) : query.isError ? (
        <QueryError error={query.error} />
      ) : (rows ?? []).length === 0 ? (
        <Placeholder
          title="Nessuna assenza"
          detail="Le richieste di ferie e permessi le mandano i dipendenti dall’app e compaiono qui. Una malattia comunicata a voce la registri dalla scheda della persona, in Team."
        />
      ) : (
        <div className="flex max-w-7xl flex-col gap-6">
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

          <PageColumns wide mainClassName="gap-8" aside={<AbsenceSummary absences={visible} />}>
            {visible.length === 0 ? (
              <Placeholder
                title="Nessuna assenza con questi filtri"
                detail={`Negli ultimi ${COMPANY_ABSENCES_DAYS_BACK} giorni non c'è niente che corrisponda. Lo storico completo di una persona è nella sua scheda, in Team.`}
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
          </PageColumns>
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


/**
 * La colonna a destra: quanto pesano le assenze nel periodo e cosa resta da
 * fare. Conta le righe già filtrate, quindi segue tipo, persona e sede scelti.
 */
function AbsenceSummary({ absences }: { absences: readonly AbsenceWithPerson[] }) {
  const s = useMemo(() => summarizeCompanyAbsences(absences), [absences]);
  return (
    <>
      <Card>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-t3">
          Riepilogo · ultimi {COMPANY_ABSENCES_DAYS_BACK} giorni
        </h2>
        <dl className="mt-4 grid grid-cols-3 gap-2">
          <SummaryTile label="Ferie" value={s.ferieDays} unit={s.ferieDays === 1 ? "giorno" : "giorni"} />
          <SummaryTile label="Permessi" value={s.permessi} unit={s.permessi === 1 ? "permesso" : "permessi"} />
          <SummaryTile label="Malattia" value={s.malattiaDays} unit={s.malattiaDays === 1 ? "giorno" : "giorni"} />
        </dl>
        <p className="mt-3 text-xs text-t4">Solo le assenze approvate, con i filtri attivi.</p>
      </Card>

      <Card>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-t3">Assenti oggi</h2>
        {s.absentToday.length === 0 ? (
          <p className="mt-3 text-sm text-t3">Nessuno è assente oggi.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2.5">
            {s.absentToday.map((a) => (
              <li key={a.id} className="flex items-center gap-3 text-sm">
                <PersonAvatar personId={a.member_id} name={a.person?.full_name ?? "Persona"} size={28} />
                <span className="min-w-0 flex-1 truncate text-t1">{a.person?.full_name ?? "Persona"}</span>
                <span className="shrink-0 text-xs text-t3">{ABSENCE_KIND_LABEL[a.kind]}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function SummaryTile({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="rounded-xl bg-bg-1 px-3 py-2.5">
      <dt className="text-xs text-t3">{label}</dt>
      <dd className="mt-1 font-serif text-2xl tabular-nums text-t1">{value}</dd>
      <dd className="text-[11px] text-t4">{unit}</dd>
    </div>
  );
}
