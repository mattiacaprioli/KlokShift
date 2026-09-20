import { useNavigate, useParams } from "react-router-dom";
import { useStartConversation } from "@/features/chat/hooks";
import { useOwnerPeople } from "@/features/staff/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useExperiences } from "@/features/experiences/hooks";
import { useWaiterPublicCard } from "@/features/reviews/hooks";
import { useWaiterProfile } from "@/features/waiterProfile/hooks";
import type { Experience } from "@/features/experiences/api";
import { Button, Card, PageHeader, Pill, Spinner } from "../ui/primitives";
import { Avatar } from "../ui/Avatar";
import { useToast } from "../ui/Toast";
import { WaiterReviews } from "../reviews/WaiterReviews";
import { REVIEWS_ENABLED } from "@/features/reviews/config";

/**
 * Profilo pubblico di un professionista: scheda a sinistra, recensioni a
 * destra. È la pagina in cui si guarda la reputazione di chi si ha in
 * organico, e guardarla è un'attività da scrivania — sul telefono le stesse informazioni
 * stanno una sotto l'altra e si perde il filo tra reputazione e persona.
 *
 * Mostra solo dati pubblici (vista `waiter_public_cards` + recensioni con RLS
 * di lettura pubblica): nessun contatto privato, nessuna email.
 */
export function ProfessionistaPage() {
  const { id } = useParams<{ id: string }>();
  // La rotta garantisce il parametro: il controllo serve solo a restringere il
  // tipo qui, una volta, invece di trascinarsi `id!` in tutto il componente.
  if (!id) return null;
  return <Profile waiterId={id} />;
}

function Profile({ waiterId }: { waiterId: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const startConversation = useStartConversation();
  const { workspaceId } = useOwnerVenues();
  const people = useOwnerPeople(workspaceId).data ?? [];

  const card = useWaiterPublicCard(waiterId).data;
  const profileQuery = useWaiterProfile(waiterId);
  const profile = profileQuery.data;
  const wp = profile?.waiter_profile ?? null;
  const experiences = useExperiences(waiterId).data ?? [];

  const name = card?.full_name ?? profile?.full_name ?? "Professionista";
  const roleCity = [card?.primary_role, card?.city].filter(Boolean).join(" · ");

  // La conversazione si apre dalla **scheda** della persona (`memberId`), non
  // dal profilo pubblico: qui si conosce solo l'account, e una chat esiste fra
  // un'azienda e una persona del suo organico.
  function onMessage() {
    const memberId = people.find((p) => p.waiter_id === waiterId)?.id;
    if (!memberId) {
      toast.show("Questa persona non fa parte del tuo organico.", "error");
      return;
    }
    startConversation.mutate(
      { memberId },
      {
        onSuccess: (conv) => navigate(`/chat/${conv.id}`),
        onError: () =>
          toast.show("Impossibile aprire la chat. Riprova.", "error"),
      }
    );
  }

  return (
    <>
      <PageHeader
        title={name}
        subtitle={roleCity || undefined}
        actions={
          <Button onClick={() => navigate(-1)}>← Indietro</Button>
        }
      />

      {profileQuery.isPending ? <Spinner /> : null}

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        {/* La scheda resta in vista mentre si scorrono le recensioni: è il
            punto di questa pagina, tenere insieme persona e reputazione. */}
        <aside className="flex flex-col gap-4 self-start lg:sticky lg:top-8">
          <Card className="flex flex-col gap-4 p-5">
            <div className="flex items-center gap-3">
              <Avatar url={card?.avatar_url ?? null} name={name} />
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-t1">
                  {name}
                </p>
                {roleCity ? (
                  <p className="truncate text-xs text-t3">{roleCity}</p>
                ) : null}
                {!REVIEWS_ENABLED ? null : card && card.rating_count ? (
                  <p className="mt-0.5 font-mono text-xs text-gold">
                    ★ {card.rating_avg?.toFixed(1)}{" "}
                    <span className="text-t4">({card.rating_count})</span>
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-t4">Nessuna recensione</p>
                )}
              </div>
            </div>

            {profile?.bio ? (
              <p className="text-sm leading-6 text-t2">{profile.bio}</p>
            ) : null}

            {wp?.specializations ? (
              <Detail label="Specializzazioni" value={wp.specializations} />
            ) : null}

            {wp?.languages && wp.languages.length > 0 ? (
              <div>
                <Label>Lingue</Label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {wp.languages.map((l) => (
                    <Pill key={l} tone="neutral">
                      {l}
                    </Pill>
                  ))}
                </div>
              </div>
            ) : null}

            {wp?.years_experience ? (
              <Detail
                label="Esperienza"
                value={`${wp.years_experience} ann${wp.years_experience === 1 ? "o" : "i"}`}
              />
            ) : null}

            <Button
              variant="gold"
              onClick={onMessage}
              disabled={startConversation.isPending}
            >
              {startConversation.isPending
                ? "Apertura chat…"
                : "Invia messaggio"}
            </Button>
          </Card>

          {experiences.length > 0 ? (
            <Card className="p-5">
              <Label>Esperienze</Label>
              <div className="mt-3 flex flex-col gap-3">
                {experiences.map((e) => (
                  <ExperienceRow key={e.id} experience={e} />
                ))}
              </div>
            </Card>
          ) : null}
        </aside>

        {REVIEWS_ENABLED ? <WaiterReviews waiterId={waiterId} /> : null}
      </div>
    </>
  );
}

function Label({ children }: { children: string }) {
  return (
    <span className="block text-xs font-semibold uppercase tracking-wider text-t3">
      {children}
    </span>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <p className="mt-1 text-sm text-t2">{value}</p>
    </div>
  );
}

function ExperienceRow({ experience }: { experience: Experience }) {
  const years = [experience.start_year, experience.end_year].filter(Boolean);
  const period =
    experience.start_year && experience.end_year
      ? `${experience.start_year}–${experience.end_year}`
      : experience.start_year
        ? `dal ${experience.start_year}`
        : years.length > 0
          ? String(years[0])
          : null;

  return (
    <div className="border-l-2 border-border-gold pl-3">
      <p className="text-sm text-t1">{experience.company_name}</p>
      <p className="text-xs text-t3">
        {experience.role ?? "Ruolo non indicato"}
        {period ? ` · ${period}` : ""}
      </p>
      {experience.detail ? (
        <p className="mt-1 text-xs leading-5 text-t4">{experience.detail}</p>
      ) : null}
    </div>
  );
}
