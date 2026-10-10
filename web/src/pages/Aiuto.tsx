import { Link } from "react-router-dom";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import {
  COLLABORATOR_TUTORIAL,
  type Tutorial,
} from "@/features/team/tutorialContent";
import { ABSENCE_MANAGER_TUTORIAL } from "@/features/absences/tutorialContent";
import {
  SUPPORT_EMAIL,
  SUPPORT_PENDING_NOTE,
  SUPPORT_SCOPE_NOTE,
  faqFor,
  supportMailto,
} from "@/features/support/supportContent";
import { Card, PageHeader } from "../ui/primitives";

/**
 * «Aiuto e supporto»: guide, domande frequenti e contatto. I testi sono quelli
 * dell'app (`supportContent.ts` e i `tutorialContent.ts` delle feature).
 */
export function AiutoPage() {
  // Una guida compare solo a chi può fare quello che spiega: i collaboratori
  // sono del titolare, le assenze di chi gestisce l'organico. Domande e
  // contatto li vedono tutti.
  const { isOwner, canAny, workspaceId, workspaceName } = useOwnerVenues();
  const canStaff = canAny("can_manage_staff");
  const faq = faqFor("web", { isOwner });

  return (
    <>
      <PageHeader title="Aiuto e supporto" />

      <div className="flex max-w-2xl flex-col gap-8">
        {isOwner || canStaff ? (
          <section>
            <SectionTitle>Guide</SectionTitle>
            <div className="flex flex-col gap-2">
              {isOwner ? (
                <TutorialSection
                  tutorial={COLLABORATOR_TUTORIAL}
                  subtitle="Cosa fare, e cosa puoi fare dopo"
                  link={{ to: "/collaboratori", label: "Vai ai collaboratori" }}
                />
              ) : null}
              {canStaff ? (
                <TutorialSection
                  tutorial={ABSENCE_MANAGER_TUTORIAL}
                  subtitle="Richieste, turni in conflitto ed export"
                  link={{ to: "/staff", label: "Vai allo staff" }}
                />
              ) : null}
            </div>
          </section>
        ) : null}

        <section>
          <SectionTitle>Domande frequenti</SectionTitle>
          <div className="flex flex-col gap-2">
            {faq.map((item) => (
              <Card key={item.q} className="p-0">
                <details className="group">
                  <summary className="focus-gold flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-4 py-3.5 text-sm font-semibold text-t1 hover:bg-bg-1">
                    {item.q}
                    <span aria-hidden className="text-t4 transition group-open:rotate-90">
                      ›
                    </span>
                  </summary>
                  <p className="border-t border-border px-4 py-4 text-sm leading-6 text-t2">
                    {item.a}
                  </p>
                </details>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle>Contattaci</SectionTitle>
          <Card className="flex flex-col gap-4">
            <p className="text-sm leading-6 text-t2">{SUPPORT_SCOPE_NOTE}</p>
            {SUPPORT_EMAIL ? (
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={supportMailto(SUPPORT_EMAIL, {
                    surface: "Dashboard web",
                    workspace: workspaceId
                      ? { id: workspaceId, name: workspaceName }
                      : null,
                  })}
                  className="focus-gold inline-flex w-fit items-center justify-center rounded-xl bg-gold px-4 py-2 text-sm font-semibold text-gold-ink transition hover:bg-gold-light"
                >
                  Scrivici
                </a>
                <span className="text-sm text-t3">{SUPPORT_EMAIL}</span>
              </div>
            ) : (
              <p className="text-xs text-t3">{SUPPORT_PENDING_NOTE}</p>
            )}
          </Card>
        </section>
      </div>
    </>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-t3">
      {children}
    </h2>
  );
}

/**
 * Una guida, con lo stesso testo dell'app (i `tutorialContent.ts` delle
 * feature). Chiusa di partenza: una guida lunga
 * aperta sposterebbe domande e contatti in fondo.
 */
function TutorialSection({
  tutorial,
  subtitle,
  link,
}: {
  tutorial: Tutorial;
  subtitle: string;
  link: { to: string; label: string };
}) {
  return (
    <Card className="p-0">
      <details className="group">
        <summary className="focus-gold flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-4 py-3.5 hover:bg-bg-1">
          <span>
            <span className="block text-sm font-semibold text-t1">
              {tutorial.title}
            </span>
            <span className="mt-0.5 block text-xs text-t3">
              {subtitle}
            </span>
          </span>
          <span aria-hidden className="text-t4 transition group-open:rotate-90">
            ›
          </span>
        </summary>

        <div className="flex flex-col gap-5 border-t border-border px-4 py-4">
          <p className="text-sm leading-6 text-t2">{tutorial.intro}</p>

          {tutorial.sections.map((section) => (
            <div key={section.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-t3">
                {section.title}
              </h3>
              {section.steps ? (
                <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-6 text-t2 marker:font-semibold marker:text-gold">
                  {section.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              ) : null}
              {section.points ? (
                <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-6 text-t2 marker:text-gold">
                  {section.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}

          <Link
            to={link.to}
            className="focus-gold inline-flex w-fit items-center justify-center rounded-xl bg-gold px-4 py-2 text-sm font-semibold text-gold-ink transition hover:bg-gold-light"
          >
            {link.label}
          </Link>
        </div>
      </details>
    </Card>
  );
}
