import { Link } from "react-router-dom";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import {
  COLLABORATOR_TUTORIAL,
  type Tutorial,
} from "@/features/team/tutorialContent";
import { ABSENCE_MANAGER_TUTORIAL } from "@/features/absences/tutorialContent";
import {
  SUPPORT_EMAIL,
  SUPPORT_RESPONSE_NOTE,
  SUPPORT_PENDING_NOTE,
  faqFor,
  supportScopeNote,
  supportMailto,
} from "@/features/support/supportContent";
import { Card, PageColumns, PageHeader } from "../ui/primitives";
import { SidebarIcon, type SidebarIconName } from "../ui/SidebarIcon";

/**
 * «Aiuto e supporto»: guide, domande frequenti e contatto. I testi sono quelli
 * dell'app (`supportContent.ts` e i `tutorialContent.ts` delle feature).
 */
export function AiutoPage() {
  // Una guida compare solo a chi può fare quello che spiega: i collaboratori
  // sono del titolare, le assenze di chi gestisce il team. Domande e
  // contatto li vedono tutti.
  const { isOwner, canAny, workspaceId, workspaceName } = useOwnerVenues();
  const canStaff = canAny("can_manage_staff");
  const faq = faqFor("web", { isOwner });
  // Le pagine di cui parlano guide e domande, solo per chi può aprirle: gli
  // stessi controlli della barra laterale.
  const quickLinks: { to: string; label: string; icon: SidebarIconName }[] = [
    ...(isOwner ? [{ to: "/collaboratori", label: "Collaboratori", icon: "team" as const }] : []),
    ...(canStaff ? [{ to: "/assenze", label: "Assenze", icon: "absence" as const }] : []),
    ...(isOwner ? [{ to: "/piano", label: "Piano e accesso", icon: "plan" as const }] : []),
    { to: "/impostazioni", label: "Impostazioni", icon: "settings" },
  ];

  return (
    <>
      <PageHeader title="Aiuto e supporto" />

      <PageColumns
        mainClassName="gap-8"
        aside={
          <>
            <section>
              <SectionTitle>Contattaci</SectionTitle>
              <Card className="flex flex-col gap-4">
                <p className="text-sm leading-6 text-t2">
                  {supportScopeNote({ isOwner })}
                </p>
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
                    <p className="w-full text-xs text-t3">{SUPPORT_RESPONSE_NOTE}</p>
                  </div>
                ) : (
                  <p className="text-xs text-t3">{SUPPORT_PENDING_NOTE}</p>
                )}
              </Card>
            </section>
            <section>
              <SectionTitle>Vai a</SectionTitle>
              <Card className="flex flex-col gap-1 p-2">
                {quickLinks.map((l) => (
                  <Link
                    key={l.to}
                    to={l.to}
                    className="focus-gold flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm text-t2 transition hover:bg-bg-2 hover:text-t1"
                  >
                    <span className="flex items-center gap-3">
                      <SidebarIcon name={l.icon} />
                      {l.label}
                    </span>
                    <span aria-hidden className="text-t4">›</span>
                  </Link>
                ))}
              </Card>
            </section>
          </>
        }
      >
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
                  link={{ to: "/assenze", label: "Vai alle assenze" }}
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

      </PageColumns>
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
