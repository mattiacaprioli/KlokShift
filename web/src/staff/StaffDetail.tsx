import { useState } from "react";
import { userErrorMessage } from "@/lib/errors";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useStartConversation } from "@/features/chat/hooks";
import {
  useRemoveStaffMember,
  useUpdateStaffMember,
  useUpdateStaffPerson,
} from "@/features/staff/hooks";
import {
  useStaffPerformance,
  useStaffWorkedShifts,
} from "@/features/assignments/hooks";
import { useWaiterPublicCard } from "@/features/reviews/hooks";
import { useSetStaffMemberRoles } from "@/features/roles/hooks";
import { REVIEWS_ENABLED } from "@/features/reviews/config";
import { RoleCheckboxes } from "./RoleCheckboxes";
import { DocumentsPanel } from "./DocumentsPanel";
import { formatDate, formatHours, formatShiftRange } from "@/lib/format";
import type { StaffMemberWithWaiter } from "@/features/staff/api";
import type { Enums } from "@/types/database";
import { cn } from "@/lib/cn";
import {
  Button,
  Card,
  Field,
  Input,
  Pill,
  Select,
  Spinner,
  Textarea,
} from "../ui/primitives";
import { useToast } from "../ui/Toast";

/**
 * Scheda di un membro dell'organico: anagrafica modificabile, ore e performance.
 * Le metriche sono calcolate con le stesse funzioni pure dell'app
 * (`isWorked`/`assignmentHours`), così i numeri coincidono sui due schermi.
 */
export function StaffDetail({
  member,
  onClose,
}: {
  member: StaffMemberWithWaiter;
  onClose: () => void;
}) {
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
              {member.display_name}
            </h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {member.link_status === "pending" ? (
                <Pill tone="warning">Invito in attesa</Pill>
              ) : member.waiter ? (
                <Pill tone="success">Account collegato</Pill>
              ) : (
                <Pill tone="neutral">Scheda senza account</Pill>
              )}
              <Pill tone="neutral">
                {member.employment_type === "fisso" ? "Fisso" : "A chiamata"}
              </Pill>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {/* Scrivere a chi hai davanti è il gesto più frequente su questa
                scheda: sta in testa, non in fondo alle performance. */}
            {member.waiter_id ? (
              <MessageButton waiterId={member.waiter_id} />
            ) : null}
            <Button onClick={onClose}>Chiudi</Button>
          </div>
        </header>

        <Anagrafica member={member} />
        <DocumentsPanel personId={member.person_id} />
        <Performance
          staffMemberId={member.id}
          waiterId={member.waiter_id ?? null}
        />
        <RemoveSection memberId={member.id} onRemoved={onClose} />
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

function Anagrafica({ member }: { member: StaffMemberWithWaiter }) {
  const updatePerson = useUpdateStaffPerson();
  const update = useUpdateStaffMember();
  const setRoles = useSetStaffMemberRoles();
  const toast = useToast();
  const [name, setName] = useState(member.display_name);
  // La scheda arriva già con i suoi ruoli embeddati dall'organico: nessuna
  // query in più, e nessuno stato da risincronizzare dopo il primo render.
  const [roleIds, setRoleIds] = useState<string[]>(
    member.staff_member_roles
      .map((r) => r.role?.id)
      .filter((id): id is string => !!id)
  );
  const [empType, setEmpType] = useState<Enums<"employment_type">>(
    member.employment_type
  );
  const [phone, setPhone] = useState(member.phone ?? "");
  const [notes, setNotes] = useState(member.note ?? "");
  const busy =
    updatePerson.isPending || update.isPending || setRoles.isPending;

  /**
   * Un gesto, tre scritture, tre livelli diversi:
   *
   *   · nome/telefono/note → la **persona** (`staff_people`), quindi valgono in
   *     tutte le sedi del titolare in cui lavora;
   *   · tipo di impiego    → questa **sede** (`staff_members`);
   *   · ruoli              → questa sede, tabella a parte.
   *
   * In quest'ordine di proposito: se una cade, quelle già passate sono salvate e
   * il messaggio dice quale pezzo è rimasto indietro.
   */
  async function onSave() {
    try {
      await updatePerson.mutateAsync({
        id: member.person_id,
        fields: {
          full_name: name.trim(),
          phone: phone.trim() || null,
          note: notes.trim() || null,
        },
      });
      await update.mutateAsync({
        id: member.id,
        fields: { employment_type: empType },
      });
      await setRoles.mutateAsync({ staffMemberId: member.id, roleIds });
      toast.show("Scheda aggiornata");
    } catch (e) {
      toast.show(userErrorMessage(e), "error");
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-t3">
        Scheda
      </span>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Nome">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Telefono">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Impiego">
          <Select
            value={empType}
            onChange={(e) =>
              setEmpType(e.target.value as Enums<"employment_type">)
            }
          >
            <option value="fisso">Fisso</option>
            <option value="a_chiamata">A chiamata</option>
          </Select>
        </Field>
      </div>

      <Field label="Ruoli">
        <RoleCheckboxes
          venueId={member.venue_id}
          value={roleIds}
          onChange={setRoleIds}
        />
      </Field>

      <Field label="Note" hint="Private, visibili solo a te.">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <div>
        <Button
          variant="gold"
          disabled={busy || !name.trim()}
          onClick={() => void onSave()}
        >
          {busy ? "Salvataggio…" : "Salva"}
        </Button>
      </div>
    </section>
  );
}

function Performance({
  staffMemberId,
  waiterId,
}: {
  staffMemberId: string;
  waiterId: string | null;
}) {
  // Totali dal database; la lista sono solo le ultime righe, già limitate.
  const perfQuery = useStaffPerformance(staffMemberId);
  const recentQuery = useStaffWorkedShifts(staffMemberId);
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

function RemoveSection({
  memberId,
  onRemoved,
}: {
  memberId: string;
  onRemoved: () => void;
}) {
  const remove = useRemoveStaffMember();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="mt-auto border-t border-border pt-4">
      {confirming ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs leading-5 text-warning">
            Rimuovendo questa persona perdi anche lo storico delle sue ore, e le
            sue assegnazioni future vengono cancellate.
          </p>
          <div className="flex gap-2">
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(memberId, {
                  onSuccess: onRemoved,
                  onError: (e) => toast.show(userErrorMessage(e), "error"),
                })
              }
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
