import { useMemo, type ReactNode } from "react";
import { COMPANY_ABSENCES_DAYS_BACK } from "@/features/absences/api";
import { useCompanyAbsences } from "@/features/absences/hooks";
import { groupCompanyAbsences } from "@/features/absences/labels";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { AbsenceRow } from "../absences/AbsencesPanel";
import {
  PageHeader,
  Placeholder,
  QueryError,
  Spinner,
} from "../ui/primitives";

/**
 * Ferie, permessi e malattie di tutta l'azienda: da decidere, in corso e
 * prossime, passate da poco. Lo storico intero di una persona sta nella sua
 * scheda in Staff.
 *
 * ⚠️ Gemello app in `src/app/(manager)/assenze.tsx`.
 */
export function AssenzePage() {
  const { canAny } = useOwnerVenues();
  const canStaff = canAny("can_manage_staff");
  const query = useCompanyAbsences(canStaff);

  const rows = query.data;
  const { pending, upcoming, closed } = useMemo(
    () => groupCompanyAbsences(rows ?? []),
    [rows]
  );

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
        <Spinner />
      ) : query.isError ? (
        <QueryError error={query.error} />
      ) : pending.length + upcoming.length + closed.length === 0 ? (
        <Placeholder
          title="Nessuna assenza"
          detail="Le richieste di ferie e permessi arrivano in chat e compaiono qui. Una malattia comunicata a voce la registri dalla scheda della persona, in Staff."
        />
      ) : (
        <div className="flex max-w-3xl flex-col gap-8">
          {pending.length > 0 ? (
            <Section title={`Da decidere · ${pending.length}`}>
              {pending.map((a) => (
                <AbsenceRow
                  key={a.id}
                  absence={a}
                  personName={a.person?.full_name ?? "Persona"}
                />
              ))}
            </Section>
          ) : null}

          <Section title="In corso e prossime">
            {upcoming.length > 0 ? (
              upcoming.map((a) => (
                <AbsenceRow
                  key={a.id}
                  absence={a}
                  personName={a.person?.full_name ?? "Persona"}
                />
              ))
            ) : (
              <p className="text-sm text-t4">
                Nessuna assenza approvata in arrivo.
              </p>
            )}
          </Section>

          {closed.length > 0 ? (
            <Section title="Passate e chiuse">
              {closed.map((a) => (
                <AbsenceRow
                  key={a.id}
                  absence={a}
                  personName={a.person?.full_name ?? "Persona"}
                />
              ))}
            </Section>
          ) : null}
        </div>
      )}
    </>
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
