import { useState } from "react";
import { userErrorMessage } from "@/lib/errors";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useStartConversation } from "@/features/chat/hooks";
import {
  useRemoveStaffMember,
  useStaffPerson,
  useUpdateStaffMember,
  useUpdateStaffPerson,
} from "@/features/staff/hooks";
import {
  usePersonPerformance,
  usePersonWorkedShifts,
} from "@/features/assignments/hooks";
import { useWaiterPublicCard } from "@/features/reviews/hooks";
import { useSetStaffMemberRoles } from "@/features/roles/hooks";
import { REVIEWS_ENABLED } from "@/features/reviews/config";
import {
  CONTRACT_PERIOD_SHORT,
  CONTRACT_PERIODS,
  personContract,
  type ContractPeriod,
} from "@/features/staff/contract";
import { RoleCheckboxes } from "./RoleCheckboxes";
import { DocumentsPanel } from "./DocumentsPanel";
import {
  formatBirthday,
  formatDate,
  formatHours,
  formatShiftRange,
} from "@/lib/format";
import type {
  PersonMembership,
  StaffPersonDetail,
} from "@/features/staff/api";
import type { Enums } from "@/types/database";
import { cn } from "@/lib/cn";
import {
  Button,
  Card,
  Field,
  Input,
  Pill,
  Placeholder,
  QueryError,
  Select,
  Spinner,
  Textarea,
} from "../ui/primitives";
import { useToast } from "../ui/Toast";

/**
 * La scheda di un dipendente: **una per persona**, non una per sede.
 *
 * Anagrafica (vale in tutte le sedi), ore e performance dell'azienda, documenti, e
 * una card per ogni sede in cui lavora con i ruoli e il tipo di impiego di *quella*
 * sede. Prima Marco ne aveva due, e ognuna mostrava le ore di una sola sede.
 */
export function StaffDetail({
  personId,
  onClose,
}: {
  personId: string;
  onClose: () => void;
}) {
  const { data, isPending, isError, error } = useStaffPerson(personId);

  if (isPending || isError || !data) {
    return (
      <div className="fixed inset-0 z-50 flex justify-end">
        <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
        <div className="relative flex h-full w-full max-w-lg flex-col gap-6 overflow-y-auto border-l border-border-2 bg-bg-0 p-6">
          <div className="flex justify-end">
            <Button onClick={onClose}>Chiudi</Button>
          </div>
          {isError ? (
            <QueryError error={error} />
          ) : isPending ? (
            <Spinner />
          ) : (
            <Placeholder
              title="Scheda non trovata"
              detail="Questa persona non fa più parte del tuo organico."
            />
          )}
        </div>
      </div>
    );
  }

  return <PersonPanel person={data} onClose={onClose} />;
}

function PersonPanel({
  person,
  onClose,
}: {
  person: StaffPersonDetail;
  onClose: () => void;
}) {
  const memberships = person.memberships;
  // Le sedi dove lavora **adesso**: quelle lasciate restano nella scheda (sono
  // lo storico delle sue ore) ma non sono chip di dove trovarlo.
  const liveMemberships = memberships.filter((m) => m.link_status !== "left");
  const multiVenue = liveMemberships.length > 1;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative flex h-full w-full max-w-lg flex-col gap-6 overflow-y-auto border-l border-border-2 bg-bg-0 p-6">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate font-serif text-xl text-t1">
              {person.full_name}
            </h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {person.waiter ? (
                <Pill tone="success">Account collegato</Pill>
              ) : (
                <Pill tone="neutral">Scheda senza account</Pill>
              )}
              {liveMemberships.map((m) => (
                <Pill key={m.id} tone="neutral">
                  {m.venue?.name ?? "Locale"}
                </Pill>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {/* Scrivere a chi hai davanti è il gesto più frequente su questa
                scheda: sta in testa, non in fondo alle performance. */}
            {person.waiter_id ? (
              <MessageButton waiterId={person.waiter_id} />
            ) : null}
            <Button onClick={onClose}>Chiudi</Button>
          </div>
        </header>

        <Anagrafica person={person} />
        <ContractSection person={person} />
        <DocumentsPanel personId={person.id} />
        <Performance
          personId={person.id}
          waiterId={person.waiter_id ?? null}
          showVenue={multiVenue}
        />
        <Workplaces person={person} multiVenue={multiVenue} />
        <RemoveSection person={person} onRemoved={onClose} />
      </div>
    </div>
  );
}

/**
 * Apre (o riapre) la chat con la persona. Esiste solo per chi ha un account
 * collegato: senza `waiter_id` non c'è nessuno dall'altra parte, e l'invito in
 * attesa è proprio il caso in cui scrivere due righe serve di più.
 */
function MessageButton({ waiterId }: { waiterId: string }) {
  const navigate = useNavigate();
  const { session } = useAuth();
  const toast = useToast();
  const startConversation = useStartConversation();

  return (
    <Button
      variant="gold"
      disabled={startConversation.isPending}
      onClick={() =>
        startConversation.mutate(
          { waiterId, managerId: session!.user.id },
          {
            onSuccess: (conv) => navigate(`/chat/${conv.id}`),
            onError: (e) => toast.show(userErrorMessage(e), "error"),
          }
        )
      }
    >
      {startConversation.isPending ? "Apertura…" : "Messaggio"}
    </Button>
  );
}

/**
 * L'anagrafica della persona: vale in **tutte** le sedi, quindi una sola
 * scrittura e un solo Salva. Prima questo form ne faceva tre su tre livelli
 * diversi; con N sedi diventerebbero 1+2N sotto un bottone solo, e «quale pezzo è
 * rimasto indietro» una lotteria. Ruoli e impiego stanno in "Dove lavora".
 */
function Anagrafica({ person }: { person: StaffPersonDetail }) {
  const update = useUpdateStaffPerson();
  const toast = useToast();
  const [name, setName] = useState(person.full_name);
  const [phone, setPhone] = useState(person.phone ?? "");
  const [notes, setNotes] = useState(person.note ?? "");

  async function onSave() {
    try {
      await update.mutateAsync({
        id: person.id,
        fields: {
          full_name: name.trim(),
          phone: phone.trim() || null,
          note: notes.trim() || null,
        },
      });
      toast.show("Anagrafica aggiornata");
    } catch (e) {
      toast.show(userErrorMessage(e), "error");
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-t3">
        Anagrafica
      </span>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Nome">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Telefono">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
      </div>

      <Field label="Note" hint="Private, visibili solo a te.">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <div>
        <Button
          variant="gold"
          disabled={update.isPending || !name.trim()}
          onClick={() => void onSave()}
        >
          {update.isPending ? "Salvataggio…" : "Salva anagrafica"}
        </Button>
      </div>

      <BirthdayRow person={person} />
    </section>
  );
}

/**
 * Il compleanno, in sola lettura e fuori dal modulo.
 *
 * Non è un dato del titolare: lo mette il professionista dal suo profilo
 * nell'app, e arriva qui solo se ha scelto di metterlo. Giorno e mese, mai
 * l'anno — in `profiles` l'anno non c'è proprio (20260914160000). Sparisce
 * quando non è stato messo: una riga «non indicato» inviterebbe a chiederlo.
 */
function BirthdayRow({ person }: { person: StaffPersonDetail }) {
  const label = formatBirthday(
    person.waiter?.birth_day ?? null,
    person.waiter?.birth_month ?? null
  );
  if (!label) return null;

  return (
    <div className="flex items-baseline gap-2 rounded-xl border border-border bg-bg-card px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-t3">
        Compleanno
      </span>
      <span className="text-sm font-semibold text-t1">{label}</span>
    </div>
  );
}

/**
 * Le ore da contratto: quante ne deve fare, e su che periodo.
 *
 * Sta sulla persona come l'anagrafica, perché il contratto lo firma l'azienda —
 * chi lavora a Roma e a Milano ha un monte ore solo, ed è lo stesso motivo per
 * cui il planning somma le ore di tutte le sedi. Da lì viene il confronto nella
 * colonna ore della vista "persone"; qui non si blocca niente.
 */
function ContractSection({ person }: { person: StaffPersonDetail }) {
  const update = useUpdateStaffPerson();
  const toast = useToast();
  const contract = personContract(person);
  const [hours, setHours] = useState(
    contract ? String(contract.hours).replace(".", ",") : ""
  );
  const [period, setPeriod] = useState<ContractPeriod>(
    contract?.period ?? "week"
  );

  // La virgola è come si scrivono i decimali in italiano, e il campo è testo
  // proprio per accettarla: "37,5" da una tastiera italiana non deve diventare
  // NaN e cancellare in silenzio il contratto.
  const parsed = hours.trim() ? Number(hours.trim().replace(",", ".")) : null;
  const invalid =
    parsed != null && (!Number.isFinite(parsed) || parsed <= 0 || parsed > 400);

  async function onSave() {
    if (invalid) return;
    try {
      await update.mutateAsync({
        id: person.id,
        // Campo vuoto = nessun contratto: le due colonne si azzerano insieme,
        // come impone `staff_people_contract_pair_ck`.
        fields:
          parsed == null
            ? { contract_hours: null, contract_period: null }
            : { contract_hours: parsed, contract_period: period },
      });
      toast.show(parsed == null ? "Contratto rimosso" : "Contratto aggiornato");
    } catch (e) {
      toast.show(userErrorMessage(e), "error");
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-t3">
        Contratto
      </span>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Ore da contratto"
          error={invalid ? "Un numero fra 0 e 400." : undefined}
        >
          <Input
            value={hours}
            inputMode="decimal"
            placeholder="Es. 40"
            onChange={(e) => setHours(e.target.value)}
          />
        </Field>
        <Field label="Periodo">
          {/* Sempre attivo, anche a ore vuote: si sceglie prima il periodo e poi
              si scrivono le ore quanto il contrario, e un campo che non si apre
              sembra rotto. Senza ore non viene comunque salvato niente — le due
              colonne si azzerano insieme. */}
          <Select
            value={period}
            onChange={(e) => setPeriod(e.target.value as ContractPeriod)}
          >
            {CONTRACT_PERIODS.map((p) => (
              <option key={p} value={p}>
                {CONTRACT_PERIOD_SHORT[p]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <p className="text-xs text-t4">
        Quante ore deve fare. Servono solo a confrontarle con i turni che
        programmi, nella vista <b>persone</b> del planning: non bloccano niente.
        Lascia vuoto se non vuoi il confronto.
      </p>

      <div>
        <Button
          variant="gold"
          disabled={update.isPending || invalid}
          onClick={() => void onSave()}
        >
          {update.isPending ? "Salvataggio…" : "Salva contratto"}
        </Button>
      </div>
    </section>
  );
}

/** Le sedi in cui la persona lavora: una card per sede, con il suo Salva. */
function Workplaces({
  person,
  multiVenue,
}: {
  person: StaffPersonDetail;
  multiVenue: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-t3">
        {multiVenue
          ? `Dove lavora · ${person.memberships.filter((m) => m.link_status !== "left").length}`
          : "Dove lavora"}
      </span>
      {person.memberships.map((m) => (
        <WorkplaceCard
          key={m.id}
          person={person}
          membership={m}
          isOnly={!multiVenue}
        />
      ))}
    </section>
  );
}

function WorkplaceCard({
  person,
  membership,
  /** Unica sede: la rimozione sta nel bottone globale in fondo al pannello. */
  isOnly,
}: {
  person: StaffPersonDetail;
  membership: PersonMembership;
  isOnly: boolean;
}) {
  const update = useUpdateStaffMember();
  const setRoles = useSetStaffMemberRoles();
  const remove = useRemoveStaffMember();
  const toast = useToast();
  const [roleIds, setRoleIds] = useState<string[]>(
    membership.staff_member_roles
      .map((r) => r.role?.id)
      .filter((id): id is string => !!id)
  );
  const [empType, setEmpType] = useState<Enums<"employment_type">>(
    membership.employment_type
  );
  const [confirming, setConfirming] = useState(false);

  const venueName = membership.venue?.name ?? "Locale";
  const busy = update.isPending || setRoles.isPending || remove.isPending;

  async function onSave() {
    try {
      await update.mutateAsync({
        id: membership.id,
        fields: { employment_type: empType },
      });
      await setRoles.mutateAsync({ staffMemberId: membership.id, roleIds });
      toast.show(`${venueName} aggiornato`);
    } catch (e) {
      toast.show(userErrorMessage(e), "error");
    }
  }

  // Appartenenza finita: resta in scheda perché le ore di quella sede sono
  // sue, ma non c'è più niente da modificare. Per riprenderla si riaggiunge la
  // persona alla sede, e la stessa riga torna attiva (`addPersonToVenue`).
  if (membership.link_status === "left") {
    return (
      <Card className="flex flex-col gap-2 p-4 opacity-70">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-t2">
            {venueName}
          </span>
          <Pill tone="neutral">Non più in organico</Pill>
        </div>
        <p className="text-xs leading-5 text-t3">
          {membership.left_at
            ? `Ha lasciato questa sede il ${formatDate(membership.left_at.slice(0, 10))}. `
            : ""}
          Le ore dei turni già fatti restano nel rendiconto.
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-t1">
          {venueName}
        </span>
        {membership.link_status === "pending" ? (
          <Pill tone="warning">Invito in attesa</Pill>
        ) : null}
        {membership.venue?.closed_at ? (
          <Pill tone="neutral">Sede chiusa</Pill>
        ) : null}
      </div>

      <Field label="Impiego in questa sede">
        <Select
          value={empType}
          onChange={(e) =>
            setEmpType(e.target.value as Enums<"employment_type">)
          }
          className="w-40"
        >
          <option value="fisso">Fisso</option>
          <option value="a_chiamata">A chiamata</option>
        </Select>
      </Field>

      {/* I ruoli sono di QUESTA sede: `venue_roles` non attraversa i locali. */}
      <Field label="Ruoli in questa sede">
        <RoleCheckboxes
          venueId={membership.venue_id}
          value={roleIds}
          onChange={setRoleIds}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="gold" disabled={busy} onClick={() => void onSave()}>
          {busy ? "Salvataggio…" : "Salva"}
        </Button>
        {!isOnly ? (
          confirming ? (
            <>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  remove.mutate(membership.id, {
                    onSuccess: () => toast.show(`Rimosso da ${venueName}`),
                    onError: (e) => toast.show(userErrorMessage(e), "error"),
                  })
                }
              >
                {remove.isPending ? "Rimozione…" : "Conferma"}
              </Button>
              <Button onClick={() => setConfirming(false)}>Annulla</Button>
            </>
          ) : (
            <Button onClick={() => setConfirming(true)}>
              Rimuovi da {venueName}
            </Button>
          )
        ) : null}
      </div>

      {confirming && !isOnly ? (
        // Da 20260914102811 non è una cancellazione: l'appartenenza passa a
        // `link_status = 'left'` e lo storico resta. Spariscono solo i turni
        // futuri, che nessuno coprirebbe.
        <p className="text-xs leading-5 text-warning">
          {person.full_name} non sarà più in organico a {venueName}. I turni
          futuri già assegnati vengono annullati e tornano da coprire; le ore dei
          turni passati restano nel rendiconto. Resta nel tuo organico nelle
          altre sedi.
        </p>
      ) : null}
    </Card>
  );
}

/**
 * Performance della **persona**, su tutte le sedi del titolare: sono i numeri
 * della sua busta paga. Prima l'aggregazione era per appartenenza, e un'assenza
 * fatta a Milano non scalfiva il 100% di affidabilità di Roma.
 */
function Performance({
  personId,
  waiterId,
  showVenue,
}: {
  personId: string;
  waiterId: string | null;
  /** Il locale su ogni turno recente: serve solo a chi ha più di una sede. */
  showVenue: boolean;
}) {
  // Totali dal database; la lista sono solo le ultime righe, già limitate.
  const perfQuery = usePersonPerformance(personId);
  const recentQuery = usePersonWorkedShifts(personId);
  const card = useWaiterPublicCard(waiterId ?? undefined).data ?? null;

  if (perfQuery.isLoading || recentQuery.isLoading) return <Spinner />;

  const perf = perfQuery.data ?? null;
  const totalPast = perf?.past_total ?? 0;
  const workedCount = perf?.worked_count ?? 0;
  const noShow = perf?.no_show_count ?? 0;
  const declined = perf?.declined_count ?? 0;
  const reliability = totalPast > 0 ? workedCount / totalPast : null;
  const totalHours = perf?.total_hours ?? 0;
  const recent = recentQuery.data ?? [];

  return (
    <section className="flex flex-col gap-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-t3">
        Performance
      </span>

      {/* Con le recensioni spente resta il link alla scheda: chi è, cosa sa
          fare. La media clienti invece non ha più dove vivere. */}
      {waiterId && !REVIEWS_ENABLED ? (
        <Card className="flex items-center justify-between gap-3 p-4">
          <span className="text-sm text-t2">Profilo del professionista</span>
          <Link
            to={`/professionista/${waiterId}`}
            className="focus-gold text-xs text-gold underline underline-offset-2"
          >
            Apri
          </Link>
        </Card>
      ) : null}

      {waiterId && REVIEWS_ENABLED ? (
        <Card className="flex items-center justify-between gap-3 p-4">
          <span className="text-sm text-t2">Valutazione clienti</span>
          <span className="flex items-center gap-3">
            {card && card.rating_count ? (
              <span className="font-mono text-sm text-gold">
                ★ {card.rating_avg?.toFixed(1)}{" "}
                <span className="text-t4">({card.rating_count})</span>
              </span>
            ) : (
              <span className="text-xs text-t4">Nessuna recensione</span>
            )}
            {/* Qui c'è solo la media: le recensioni per esteso stanno sul
                profilo pubblico. */}
            <Link
              to={`/professionista/${waiterId}`}
              className="focus-gold text-xs text-gold underline underline-offset-2"
            >
              Profilo
            </Link>
          </span>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <p className="font-mono text-2xl text-t1">{workedCount}</p>
          <p className="mt-1 text-xs text-t3">turni svolti</p>
        </Card>
        <Card className="p-4">
          <p className="font-mono text-2xl text-t1">
            {formatHours(totalHours)}
          </p>
          <p className="mt-1 text-xs text-t3">ore totali</p>
        </Card>
      </div>

      {reliability != null ? (
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-t2">Affidabilità</span>
            <span className="text-sm font-semibold text-gold">
              {Math.round(reliability * 100)}%
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-bg-2">
            <div
              className={cn(
                "h-1.5 rounded-full",
                reliability >= 0.9 ? "bg-success" : "bg-warning"
              )}
              style={{ width: `${reliability * 100}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-t3">
            {noShow + declined > 0
              ? `${noShow} assenze · ${declined} rifiuti su ${totalPast} turni`
              : `Sempre presente su ${totalPast} ${totalPast === 1 ? "turno" : "turni"}`}
          </p>
        </Card>
      ) : null}

      {recent.length > 0 ? (
        <div>
          <span className="mb-2 block text-xs text-t4">Ultimi turni</span>
          <Card className="p-0">
            {recent.map((a, i) => (
              <div
                key={a.id}
                className={cn(
                  "flex items-center justify-between px-4 py-2.5 text-sm",
                  i > 0 && "border-t border-border"
                )}
              >
                <span className="text-t2">
                  {formatDate(a.date)}
                  <span className="ml-2 font-mono text-xs text-t4">
                    {formatShiftRange(a.start_time, a.end_time)}
                  </span>
                  {/* Senza la sede, due turni lo stesso giovedì alla stessa ora
                      in due locali diversi sembrerebbero un doppione. */}
                  {showVenue ? (
                    <span className="ml-2 text-xs text-t4">
                      · {a.venue_name}
                    </span>
                  ) : null}
                </span>
                <span className="font-mono text-xs text-t1">
                  {formatHours(a.hours)}
                </span>
              </div>
            ))}
          </Card>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Rimozione totale: una scrittura per appartenenza. L'ultima fa scattare
 * `staff_members_zz_orphan_person`, che cancella la persona e con lei i documenti.
 */
function RemoveSection({
  person,
  onRemoved,
}: {
  person: StaffPersonDetail;
  onRemoved: () => void;
}) {
  const remove = useRemoveStaffMember();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  async function doRemoveAll() {
    try {
      // Solo le sedi ancora attive: `remove_staff_member` rifiuta una riga già
      // 'left' e il ciclo si fermerebbe su un lavoro già fatto.
      for (const m of person.memberships.filter((m) => m.link_status !== "left")) {
        await remove.mutateAsync(m.id);
      }
      onRemoved();
    } catch (e) {
      toast.show(userErrorMessage(e), "error");
    }
  }

  return (
    <section className="mt-auto border-t border-border pt-4">
      {confirming ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs leading-5 text-warning">
            {person.full_name} non lavorerà più in nessuna delle tue sedi. I
            turni futuri già assegnati vengono annullati; ore, presenze e
            documenti restano nella sua scheda e nell&apos;export. Per
            riprenderlo in futuro basta riaggiungerlo dall&apos;organico.
          </p>
          <div className="flex gap-2">
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => void doRemoveAll()}
            >
              {remove.isPending ? "Rimozione…" : "Conferma rimozione"}
            </Button>
            <Button onClick={() => setConfirming(false)}>Annulla</Button>
          </div>
        </div>
      ) : (
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Rimuovi dall&apos;organico
        </Button>
      )}
    </section>
  );
}
