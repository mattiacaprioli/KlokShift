import { useState } from "react";
import { Link } from "react-router-dom";
import { useAdminRead } from "@/features/admin/hooks";
import {
  ACTIVATION_STEP_LABEL,
  activationStep,
  daysBetween,
  listActivation,
  type ActivationRow,
} from "@/features/admin/activation";
import { userErrorMessage } from "@/lib/errors";
import { Card, Pill } from "../ui/primitives";
import { date, labels } from "./format";
import { AllClear, CardSkeleton, Footnote, Pager, SectionHeader } from "./ui";

/** «dopo 3 g» o «—»: i giorni dalla nascita dell'azienda a quel passo. */
function after(row: ActivationRow, at: string | null) {
  const days = daysBetween(row.created_at, at);
  return days === null ? "—" : days === 0 ? "stesso giorno" : `dopo ${days} g`;
}

/**
 * Dove si fermano le aziende: sede, prova, team, email, primo turno, prima
 * conferma. Le più recenti prima. Solo date e conteggi, nessuna persona.
 */
export function Activation({ userId }: { userId: string }) {
  const [offset, setOffset] = useState(0);
  const query = useAdminRead(userId, "activation", { offset }, () => listActivation(offset));
  const title = "Attivazione";
  if (query.isPending || query.isFetching) return <CardSkeleton title={title} rows={3} />;
  if (query.isError) {
    return <Card><SectionHeader title={title} icon="activity" /><p role="alert" className="text-sm text-error">{userErrorMessage(query.error)}</p></Card>;
  }
  const d = query.data;
  if (d.items.length === 0 && offset === 0) return <AllClear icon="activity" title={title}>Nessuna azienda ancora.</AllClear>;
  return <Card>
    <SectionHeader title={title} icon="activity" />
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs text-t3">
          <tr>
            <th className="py-2 pr-3 font-medium">Azienda</th>
            <th className="py-2 pr-3 font-medium">Ferma a</th>
            <th className="py-2 pr-3 font-medium">Prova</th>
            <th className="py-2 pr-3 font-medium">Team</th>
            <th className="py-2 pr-3 font-medium">Primo turno</th>
            <th className="py-2 font-medium">Prima conferma</th>
          </tr>
        </thead>
        <tbody>
          {d.items.map((r) => {
            const step = activationStep(r);
            return <tr key={r.workspace_id} className="border-t border-border-2 align-top">
              <td className="py-2.5 pr-3">
                <Link className="focus-gold rounded font-semibold text-t1 hover:text-gold" to={`/amministrazione/aziende/${r.workspace_id}`}>{r.workspace_name}</Link>
                <span className="block text-xs text-t4">{date(r.created_at)} · {labels[r.classification]}</span>
              </td>
              <td className="py-2.5 pr-3"><Pill tone={step === "active" ? "success" : "warning"}>{ACTIVATION_STEP_LABEL[step]}</Pill></td>
              <td className="py-2.5 pr-3 text-t2">{after(r, r.trial_started_at)}</td>
              <td className="py-2.5 pr-3 text-t2">
                {r.people}
                <span className="block text-xs text-t4">{r.with_email} con email · {r.linked} nell’app</span>
              </td>
              <td className="py-2.5 pr-3 text-t2">{after(r, r.first_shift_at)}</td>
              <td className="py-2.5 text-t2">{after(r, r.first_confirmed_at)}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    <Pager page={d} onOffset={setOffset} />
    <Footnote className="mt-4">Giorni contati dalla creazione dell’azienda. Il team conta chi lavora nei turni (titolare compreso); il primo turno è il primo pianificato, non un fuori turno né uno registrato a posteriori.</Footnote>
  </Card>;
}
