import { useState } from "react";
import { useAbsencesToHandle } from "@/features/absences/hooks";
import {
  ABSENCE_KIND_LABEL,
  formatAbsenceRange,
} from "@/features/absences/labels";
import { Button, Card, Pill } from "../ui/primitives";
import { AbsenceConflictsBlock } from "./AbsenceConflicts";
import { ResolveAbsenceForm } from "./ResolveAbsenceForm";

/**
 * Il blocco «Richieste» della home: ferie e permessi da decidere, malattie
 * comunicate di recente e non ancora finite. Sparisce quando non c'è niente.
 *
 * ⚠️ Gemello app in `src/features/absences/AbsencesToHandle.tsx`.
 */
export function AbsencesToHandle({ enabled }: { enabled: boolean }) {
  const query = useAbsencesToHandle(enabled);
  const rows = query.data ?? [];
  const [open, setOpen] = useState<string | null>(null);

  if (!enabled || rows.length === 0) return null;

  const pendingCount = rows.filter((a) => a.status === "pending").length;

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-t3">
        Richieste {pendingCount > 0 ? `· ${pendingCount} da decidere` : ""}
      </h2>
      <div className="flex flex-col gap-2">
        {rows.map((a) => {
          const pending = a.status === "pending";
          return (
            <Card key={a.id} className="p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-t1">
                    {a.person?.full_name ?? "Persona"}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-t4">
                    {ABSENCE_KIND_LABEL[a.kind]} · {formatAbsenceRange(a)}
                    {a.note ? ` · ${a.note}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Pill tone={pending ? "gold" : "neutral"}>
                    {pending ? "Da decidere" : "Comunicata"}
                  </Pill>
                  {pending ? (
                    <Button
                      type="button"
                      onClick={() => setOpen(open === a.id ? null : a.id)}
                    >
                      {open === a.id ? "Chiudi" : "Rispondi"}
                    </Button>
                  ) : null}
                </div>
              </div>
              {pending && open === a.id ? (
                <ResolveAbsenceForm absence={a} className="mt-3" />
              ) : null}
              {pending ? null : <AbsenceConflictsBlock absence={a} />}
            </Card>
          );
        })}
      </div>
    </section>
  );
}
