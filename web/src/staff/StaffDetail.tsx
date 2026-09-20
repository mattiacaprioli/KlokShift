import { useEffect, useState, type ReactNode } from "react";
import { userErrorMessage } from "@/lib/errors";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useStartConversation } from "@/features/chat/hooks";
import {
  useAddPersonToVenue,
  useRemoveStaffMember,
  useSendStaffInvite,
  useStaffPerson,
  useUpdateStaffMember,
  useUpdateStaffPerson,
} from "@/features/staff/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { PromoteSection } from "./PromoteSection";
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
import { AbsencesPanel } from "../absences/AbsencesPanel";
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
 *
 * È un dialogo centrale diviso in tab (anagrafica, sedi, documenti, performance,
 * gestione): da cassetto laterale con tutto impilato era diventata troppo lunga.
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
      <PersonModalShell label="Scheda" onClose={onClose}>
        <div className="flex flex-col gap-6 overflow-y-auto p-6">
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
      </PersonModalShell>
    );
  }

  return <PersonPanel person={data} onClose={onClose} />;
}

/**
 * Il guscio della scheda: un dialogo al centro, non più un cassetto laterale.
 * Con due sedi il cassetto superava i due schermi di scroll; qui l'altezza è
 * limitata e a scorrere è solo il contenuto del tab.
 *
 * Altezza fissa, non solo massima: col `max-h` il dialogo si stringeva e
 * allungava a ogni tab, e l'header saltava su e giù sotto il cursore.
 */
function PersonModalShell({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // Esc chiude, come in `ConfirmDialog`.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal
        aria-label={label}
        className="relative flex h-[min(90vh,52rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border-2 bg-bg-0"
      >
        {children}
      </div>
    </div>
  );
}

type TabId =
  | "anagrafica"
  | "sedi"
  | "assenze"
  | "documenti"
  | "performance"
  | "gestione";

function PersonPanel({
  person,
  onClose,
}: {
  person: StaffPersonDetail;
  onClose: () => void;
}) {
  const { isOwner, can, canAny } = useOwnerVenues();
  const { session } = useAuth();
  /**
   * Questa scheda sono io.
   *
   * Da quando chi gestisce la sede può mettersi in organico, la propria scheda
   * si apre da qui — e metà di ciò che c'è dentro è scritto per guardare
   * qualcun altro: la chat, la promozione a collaboratore.
   */
  const isMe = !!person.waiter_id && person.waiter_id === session?.user.id;
  /**
   * Le sedi della persona che **chi guarda** gestisce: per il titolare tutte,
   * per un collaboratore solo le sue. La scheda è dell'azienda, ma lui la deve
   * leggere dalla sua sede.
   */
  const memberships = isOwner
    ? person.memberships
    : person.memberships.filter((m) => can(m.venue_id, "can_manage_staff"));
  // Le sedi dove lavora **adesso**: quelle lasciate restano nella scheda (sono
  // lo storico delle sue ore) ma non sono chip di dove trovarlo.
  const liveMemberships = memberships.filter((m) => m.link_status !== "left");
  const multiVenue = liveMemberships.length > 1;

  // Un tab compare solo se chi guarda ha qualcosa da farci: stessi permessi che
  // prima nascondevano le sezioni.
  const tabs: { id: TabId; label: string }[] = [
    { id: "anagrafica", label: "Anagrafica" },
    {
      id: "sedi",
      label: multiVenue ? `Sedi e ruoli · ${liveMemberships.length}` : "Sedi e ruoli",
    },
    // Stesso permesso della RLS di `staff_absences`: la malattia è un dato
    // sanitario, chi fa solo i turni non la legge.
    ...(canAny("can_manage_staff")
      ? [{ id: "assenze" as const, label: "Assenze" }]
      : []),
    ...(canAny("can_manage_documents")
      ? [{ id: "documenti" as const, label: "Documenti" }]
      : []),
    ...(canAny("can_view_hours")
      ? [{ id: "performance" as const, label: "Performance" }]
      : []),
    // La promozione è del titolare e di nessun altro: un collaboratore che
    // potesse promuoverne altri sarebbe una catena di deleghe. E non su sé
    // stesso: chi apre la propria scheda la sede la gestisce già.
    ...(isOwner && person.waiter_id && !isMe && liveMemberships.length > 0
      ? [{ id: "gestione" as const, label: "Gestione" }]
      : []),
  ];
  const [selected, setSelected] = useState<TabId>("anagrafica");
  // Il tab scelto può sparire mentre la scheda è aperta (es. la persona lascia
  // l'ultima sede e «Gestione» non ha più senso): si torna all'anagrafica.
  const tab = tabs.some((t) => t.id === selected) ? selected : "anagrafica";

  return (
    <PersonModalShell label={person.full_name} onClose={onClose}>
        <header className="flex items-start justify-between gap-4 px-6 pt-6">
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
                  {m.venue?.name ?? "Sede"}
                </Pill>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {/* Scrivere a chi hai davanti è il gesto più frequente su questa
                scheda: sta in testa, non in fondo alle performance. */}
            {/* La conversazione è la coppia (professionista, titolare) e non è
                scopata per sede: aprirla come collaboratore creerebbe un thread
                che il titolare non vede e che al professionista arriva da uno
                sconosciuto. */}
            {/* E con sé stessi non esiste. */}
            {person.waiter_id && isOwner && !isMe ? (
              <MessageButton memberId={person.id} />
            ) : null}
            <Button onClick={onClose}>Chiudi</Button>
          </div>
        </header>

        <nav
          role="tablist"
          aria-label="Sezioni della scheda"
          className="mt-4 flex shrink-0 gap-1 overflow-x-auto border-b border-border px-6"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setSelected(t.id)}
              className={cn(
                "focus-gold -mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition",
                tab === t.id
                  ? "border-gold font-semibold text-gold"
                  : "border-transparent text-t3 hover:text-t1"
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* I pannelli inattivi restano montati e solo nascosti: i form tengono
            gli edit in stato locale, e cambiare tab non deve buttarli via. */}
        <div className="flex-1 overflow-y-auto p-6">
          <TabPanel active={tab === "anagrafica"}>
            <Anagrafica person={person} />
            {/* Le ore da contratto sono un accordo fra la persona e l'azienda. */}
            {isOwner ? <ContractSection person={person} /> : null}
          </TabPanel>
          <TabPanel active={tab === "sedi"}>
            <Workplaces
              memberships={memberships}
              multiVenue={multiVenue}
              person={person}
            />
            {isOwner ? (
              <RemoveSection person={person} onRemoved={onClose} />
            ) : null}
          </TabPanel>
          {canAny("can_manage_staff") ? (
            <TabPanel active={tab === "assenze"}>
              <AbsencesPanel memberId={person.id} />
            </TabPanel>
          ) : null}
          {canAny("can_manage_documents") ? (
            <TabPanel active={tab === "documenti"}>
              <DocumentsPanel personId={person.id} />
            </TabPanel>
          ) : null}
          {canAny("can_view_hours") ? (
            <TabPanel active={tab === "performance"}>
              <Performance
                personId={person.id}
                // ⚠️ `null` sulla propria scheda: `waiter_public_cards`
                // contiene solo i professionisti, quindi un gestore non ha una
                // card e la media clienti non avrebbe niente da leggere.
                waiterId={isMe ? null : (person.waiter_id ?? null)}
                showVenue={multiVenue}
              />
            </TabPanel>
          ) : null}
          {tabs.some((t) => t.id === "gestione") && person.waiter_id ? (
            <TabPanel active={tab === "gestione"}>
              <PromoteSection
                memberId={person.id}
                waiterId={person.waiter_id}
                personName={person.full_name}
              />
            </TabPanel>
          ) : null}
        </div>
    </PersonModalShell>
  );
}

function TabPanel({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      hidden={!active}
      className={cn("flex flex-col gap-6", !active && "hidden")}
    >
      {children}
    </div>
  );
}

/**
 * Apre (o riapre) la chat con la persona. Esiste solo per chi ha un account
 * collegato: senza `waiter_id` non c'è nessuno dall'altra parte, e l'invito in
 * attesa è proprio il caso in cui scrivere due righe serve di più.
 */
function MessageButton({ memberId }: { memberId: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const startConversation = useStartConversation();

  return (
    <Button
      variant="gold"
      disabled={startConversation.isPending}
      onClick={() =>
        startConversation.mutate(
          { memberId },
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
  const [email, setEmail] = useState(person.email ?? "");
  const [notes, setNotes] = useState(person.note ?? "");

  async function onSave() {
    try {
      await update.mutateAsync({
        id: person.id,
        fields: {
          full_name: name.trim(),
          phone: phone.trim() || null,
          // Con un account collegato l'indirizzo vero è quello di `auth.users`:
          // riscriverlo qui cambierebbe solo la rubrica, dando l'idea di poter
          // spostare l'account di qualcun altro.
          ...(person.waiter_id ? {} : { email: email.trim() || null }),
          note: notes.trim() || null,
        },
      });
      toast.show("Anagrafica aggiornata");
    } catch (e) {
      // L'unique (owner_id, email) tiene l'aggancio non ambiguo: detto in
      // chiaro, altrimenti arriva un 23505 grezzo.
      const msg = e instanceof Error ? e.message : "";
      toast.show(
        msg.includes("staff_people_owner_email_uq")
          ? "Hai già una scheda con questa email."
          : userErrorMessage(e),
        "error"
      );
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

      {person.waiter_id ? null : (
        <Field label="Email" hint="Serve a collegarle il suo account.">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nome@esempio.it"
          />
        </Field>
      )}

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

      <InviteRow person={person} />
      <BirthdayRow person={person} />
      <LanguagesRow person={person} />
    </section>
  );
}

/**
 * A che punto è l'invito. Lo stato non è una colonna: si legge da `email`,
 * `invited_at` e `waiter_id`, così una scheda creata prima che questa feature
 * esistesse entra nel flusso appena le si aggiunge un indirizzo.
 */
function InviteRow({ person }: { person: StaffPersonDetail }) {
  const send = useSendStaffInvite();
  const toast = useToast();

  if (person.waiter_id) {
    return (
      <div className="flex items-baseline gap-2 rounded-xl border border-border bg-bg-card px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-t3">
          Invito
        </span>
        <span className="text-sm font-semibold text-t1">Account collegato</span>
      </div>
    );
  }

  if (person.invite_conflict_at) {
    return (
      <p className="rounded-xl border border-border bg-bg-card px-4 py-3 text-sm text-t2">
        Questa email appartiene a un account già collegato a un&apos;altra scheda
        del tuo organico. Controlla se sono la stessa persona: in tal caso usa
        quella scheda ed elimina questa.
      </p>
    );
  }

  if (!person.email) return null;

  // Nessun countdown lato client: il limite (uno ogni 15 minuti, 5 in tutto) sta
  // nella RPC `claim_staff_invite_send`, che risponde con un messaggio già
  // pronto. Calcolarlo anche qui vorrebbe dire due verità che possono
  // divergere — e `Date.now()` in render non è puro.
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-bg-card px-4 py-3">
      <div className="min-w-52 flex-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-t3">
          Invito
        </span>
        <p className="mt-0.5 text-sm text-t2">
          {/* Senza participio: «invitato/invitata» imporrebbe un genere che il
              nome sulla scheda non garantisce. */}
          {person.invited_at
            ? `Invito mandato il ${formatDate(person.invited_at)}. `
            : "Invito non ancora mandato. "}
          Quando si registrerà con {person.email}, questa scheda diventerà la
          sua.
        </p>
      </div>
      <Button
        disabled={send.isPending}
        onClick={() =>
          send.mutate(person.id, {
            onSuccess: () => toast.show("Invito mandato"),
            onError: (e) => toast.show(userErrorMessage(e), "error"),
          })
        }
      >
        {/* L'etichetta dice l'azione, non il meccanismo: «Invia invito»
            lasciava il dubbio su cosa arrivi alla persona. */}
        {send.isPending
          ? "Invio…"
          : person.invited_at
            ? "Rimanda l'invito"
            : "Invita a scaricare l'app"}
      </Button>
    </div>
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
 * Le lingue parlate, in sola lettura come il compleanno qui sopra: le mette il
 * professionista dal suo profilo nell'app, e spariscono quando non ce ne sono.
 *
 * A differenza del compleanno servono a comporre una squadra — chi fa i turni
 * del sabato vuole sapere chi può stare in sala con dei turisti. È quel che
 * resta del profilo-vetrina (20260920001700), e sta qui perché è qui che si
 * guarda chi si ha, non su una pagina a parte.
 */
function LanguagesRow({ person }: { person: StaffPersonDetail }) {
  const languages = person.waiter?.languages ?? [];
  if (languages.length === 0) return null;

  return (
    <div className="flex items-baseline gap-2 rounded-xl border border-border bg-bg-card px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-t3">
        Lingue
      </span>
      <span className="text-sm font-semibold text-t1">
        {languages.join(" · ")}
      </span>
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
  memberships,
  multiVenue,
}: {
  person: StaffPersonDetail;
  /** Già filtrate su quel che chi guarda gestisce: vedi `PersonPanel`. */
  memberships: StaffPersonDetail["memberships"];
  multiVenue: boolean;
}) {
  const { isOwner, venues } = useOwnerVenues();
  const { session } = useAuth();
  const isMe = !!person.waiter_id && person.waiter_id === session?.user.id;
  const liveCount = memberships.filter((m) => m.link_status !== "left").length;
  // Riprendere qualcuno o dargli un'altra sede è del titolare: l'update su
  // `staff_members` la RLS lo concede solo a lui. Con un account, poi, solo se
  // lavora ancora per lui da qualche parte: chi ha lasciato tutte le sedi
  // l'accordo l'ha chiuso, e rimetterlo in organico senza chiederglielo sarebbe
  // decidere al posto suo.
  const canReassign = isOwner && (!person.waiter_id || liveCount > 0);
  // Le sedi dove non c'è mai stata. Quelle lasciate hanno già la loro card, con
  // il suo «Rimetti in organico».
  const otherVenues = venues.filter(
    (v) => !person.memberships.some((m) => m.venue_id === v.id)
  );

  return (
    <section className="flex flex-col gap-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-t3">
        {multiVenue ? `Dove lavora · ${liveCount}` : "Dove lavora"}
      </span>
      {memberships.map((m) => (
        <WorkplaceCard
          key={m.id}
          person={person}
          membership={m}
          isOnly={!multiVenue}
          canRestore={canReassign}
          // `remove_staff_member` rifiuta la propria scheda a un collaboratore
          // (uscire dall'organico non si fa coi poteri con cui si gestiscono
          // gli altri): senza questo il bottone chiederebbe conferma per poi
          // mostrare un errore. Il titolare invece può — la sua scheda
          // altrimenti sarebbe inamovibile.
          canRemove={!isMe || isOwner}
        />
      ))}
      {canReassign && otherVenues.length > 0 ? (
        <AddToVenue person={person} venues={otherVenues} />
      ) : null}
    </section>
  );
}

/**
 * Un'altra delle sedi del titolare per una persona che ha già. Nessun invito:
 * l'accordo c'è, e l'account, se c'è, è già sulla persona. I ruoli si scelgono
 * dopo, sulla card che compare, perché sono di quella sede.
 */
function AddToVenue({
  person,
  venues,
}: {
  person: StaffPersonDetail;
  venues: { id: string; name: string }[];
}) {
  const add = useAddPersonToVenue();
  const toast = useToast();
  const [venueId, setVenueId] = useState("");
  const [empType, setEmpType] =
    useState<Enums<"employment_type">>("a_chiamata");

  function onAdd() {
    const name = venues.find((v) => v.id === venueId)?.name ?? "sede";
    add.mutate(
      { memberId: person.id, venueId, employmentType: empType },
      {
        onSuccess: () => {
          setVenueId("");
          toast.show(`Aggiunto a ${name} · scegli i ruoli nella sua card`);
        },
        onError: (e) => toast.show(userErrorMessage(e), "error"),
      }
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <span className="text-sm font-semibold text-t1">
        Aggiungi a un&apos;altra sede
      </span>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Sede">
          <Select
            value={venueId}
            onChange={(e) => setVenueId(e.target.value)}
            className="w-56"
          >
            <option value="">Scegli…</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Impiego">
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
        <Button
          variant="gold"
          disabled={!venueId || add.isPending}
          onClick={onAdd}
        >
          {add.isPending ? "Aggiunta…" : "Aggiungi"}
        </Button>
      </div>
    </Card>
  );
}

function WorkplaceCard({
  person,
  membership,
  /** Unica sede: la rimozione sta nel bottone globale in fondo al pannello. */
  isOnly,
  /** Può rimettere in organico un'appartenenza finita: vedi `Workplaces`. */
  canRestore,
  /** Può togliere questa appartenenza: vedi `Workplaces`. */
  canRemove = true,
}: {
  person: StaffPersonDetail;
  membership: PersonMembership;
  isOnly: boolean;
  canRestore: boolean;
  canRemove?: boolean;
}) {
  const update = useUpdateStaffMember();
  const setRoles = useSetStaffMemberRoles();
  const remove = useRemoveStaffMember();
  const restore = useAddPersonToVenue();
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

  const venueName = membership.venue?.name ?? "Sede";
  const busy = update.isPending || setRoles.isPending || remove.isPending;

  async function onSave() {
    try {
      // Una sola scrittura (`set_member_venue`): tipo di impiego e mansioni
      // insieme, o passano tutte e due o non passa nessuna.
      await update.mutateAsync({
        memberId: person.id,
        venueId: membership.venue_id,
        employmentType: empType,
        roleIds,
      });
      toast.show(`${venueName} aggiornato`);
    } catch (e) {
      toast.show(userErrorMessage(e), "error");
    }
  }

  // Appartenenza finita: resta in scheda perché le ore di quella sede sono
  // sue, ma non c'è più niente da modificare. Riprenderla non crea una riga
  // nuova: `addPersonToVenue` rianima questa, con i ruoli che aveva — l'uscita
  // non li cancella. I turni annullati all'uscita invece non tornano.
  if (membership.link_status === "left") {
    return (
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-2 opacity-70">
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
        </div>
        {canRestore && !membership.venue?.closed_at ? (
          <div>
            <Button
              disabled={restore.isPending}
              onClick={() =>
                restore.mutate(
                  {
                    memberId: person.id,
                    venueId: membership.venue_id,
                    employmentType: membership.employment_type,
                  },
                  {
                    onSuccess: () =>
                      toast.show(`Di nuovo in organico a ${venueName}`),
                    onError: (e) => toast.show(userErrorMessage(e), "error"),
                  }
                )
              }
            >
              {restore.isPending ? "Un momento…" : "Rimetti in organico"}
            </Button>
          </div>
        ) : null}
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

      {/* I ruoli sono di QUESTA sede: `venue_roles` non attraversa le sedi. */}
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
        {!isOnly && canRemove ? (
          confirming ? (
            <>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  remove.mutate(
                    { memberId: person.id, venueId: membership.venue_id },
                    {
                      onSuccess: () => toast.show(`Rimosso da ${venueName}`),
                      onError: (e) => toast.show(userErrorMessage(e), "error"),
                    }
                  )
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
  /** La sede su ogni turno recente: serve solo a chi ha più di una sede. */
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
            {/* ⚠️ Qui c'è solo la media. Le recensioni per esteso stavano sul
                profilo pubblico del professionista, caduto col CV
                (20260920001700): riaccendendo `REVIEWS_ENABLED` serve una
                pagina nuova dove metterle, questo link non esiste più. */}
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
                      in due sedi diverse sembrerebbero un doppione. */}
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
      // Una sola chiamata: `remove_member` senza sede toglie la persona da
      // tutta l'azienda, sede per sede, in una transazione.
      await remove.mutateAsync({ memberId: person.id });
      onRemoved();
    } catch (e) {
      toast.show(userErrorMessage(e), "error");
    }
  }

  return (
    <section className="border-t border-border pt-4">
      {confirming ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs leading-5 text-warning">
            {person.full_name} non lavorerà più in nessuna delle tue sedi. I
            turni futuri già assegnati vengono annullati; ore, presenze e
            documenti restano nella sua scheda e nell&apos;export.
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
