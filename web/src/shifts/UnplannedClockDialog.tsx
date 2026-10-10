import { useEffect, useState } from "react";
import type { OpenUnplannedClock } from "@/features/clock/api";
import {
  useCloseUnplannedClock,
  useVoidUnplannedClock,
} from "@/features/clock/hooks";
import { formatClockTime } from "@/features/clock/hours";
import { romeDateTimeLocal, romeFieldToIso } from "@/features/clock/timezone";
import { cn } from "@/lib/cn";
import { userErrorMessage } from "@/lib/errors";
import { useNow } from "@/lib/useNow";
import { Button, Field, Textarea } from "../ui/primitives";
import { useToast } from "../ui/Toast";
import { RomeDateTimeField } from "./PresenceSection";

/**
 * Una timbratura senza turno ancora aperta, per chi ha «Ore»: registrare
 * l'uscita (dimenticata, o oltre le 16 ore che il professionista non chiude più
 * da sé) o annullare un'entrata fatta per errore. Gemello web di
 * `UnplannedClockModal`: stesse azioni, stesse frasi, orari nell'ora di Roma.
 *
 * Si monta solo quando serve, come `ConfirmDialog`.
 */
export function UnplannedClockDialog({
  clock,
  onClose,
}: {
  clock: OpenUnplannedClock;
  onClose: () => void;
}) {
  const toast = useToast();
  const close = useCloseUnplannedClock();
  const voidClock = useVoidUnplannedClock();
  const [mode, setMode] = useState<"close" | "void">("close");
  const [outAt, setOutAt] = useState(() =>
    romeDateTimeLocal(new Date().toISOString())
  );
  const [outChoice, setOutChoice] = useState<0 | 1 | undefined>();
  const [reason, setReason] = useState("");
  const pending = close.isPending || voidClock.isPending;
  const now = useNow(15_000);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  const outResult = romeFieldToIso(outAt, { ambiguousChoice: outChoice });
  const outError = !outResult.ok
    ? null
    : Date.parse(outResult.iso) <= Date.parse(clock.clockInAt)
      ? "L’uscita deve essere successiva all’entrata."
      : Date.parse(outResult.iso) > now.getTime()
        ? "L’uscita non può essere nel futuro."
        : null;
  const canSave =
    reason.trim().length > 0 &&
    !pending &&
    (mode === "void" || (outResult.ok && outError == null));

  function onConfirm() {
    if (!canSave) return;
    const handlers = {
      onSuccess: () => {
        toast.show(
          mode === "close"
            ? "Uscita registrata · il turno è da approvare"
            : "Timbratura annullata"
        );
        onClose();
      },
      onError: (error: unknown) =>
        toast.show(
          userErrorMessage(error, "Operazione non riuscita. Riprova."),
          "error"
        ),
    };
    if (mode === "close" && outResult.ok) {
      close.mutate(
        { recordId: clock.recordId, outAt: outResult.iso, reason: reason.trim() },
        handlers
      );
    } else {
      voidClock.mutate(
        { recordId: clock.recordId, reason: reason.trim() },
        handlers
      );
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={pending ? undefined : onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-label={`${clock.memberName} · fuori turno`}
        aria-modal
        className="relative flex w-full max-w-md flex-col gap-4 rounded-2xl border border-border-2 bg-bg-card p-6"
      >
        <div>
          <h2 className="font-serif text-lg text-t1">
            {clock.memberName} · fuori turno
          </h2>
          <p className="mt-1 text-sm leading-5 text-t2">
            In servizio dalle {formatClockTime(clock.clockInAt)} a{" "}
            {clock.venueName}
            {clock.roleName ? ` · ${clock.roleName}` : ""}.
            {clock.note ? ` «${clock.note}»` : ""}
          </p>
        </div>

        <div className="flex overflow-hidden rounded-xl border border-border-2">
          {(["close", "void"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "focus-gold flex-1 px-3 py-1.5 text-xs font-semibold transition",
                mode === m
                  ? "bg-gold text-gold-ink"
                  : "bg-bg-2 text-t2 hover:bg-bg-3"
              )}
            >
              {m === "close" ? "Registra uscita" : "Annulla entrata"}
            </button>
          ))}
        </div>

        {mode === "close" ? (
          <div>
            <RomeDateTimeField
              label="Uscita"
              value={outAt}
              onChange={setOutAt}
              choice={outChoice}
              onChoice={setOutChoice}
              result={outResult}
            />
            <p
              className={cn(
                "mt-1 text-xs leading-5",
                outError ? "text-warning" : "text-t4"
              )}
            >
              {outError ??
                "All’uscita nasce il turno «Fuori turno» con questi orari, da approvare."}
            </p>
          </div>
        ) : (
          <p className="text-xs leading-5 text-t4">
            L’entrata non verrà conteggiata, ma resterà nello storico.
          </p>
        )}

        <Field label="Motivo">
          <Textarea
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              mode === "close"
                ? "Es. uscita dimenticata, confermata a voce"
                : "Es. timbrata per errore"
            }
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button
            variant={mode === "close" ? "gold" : "danger"}
            disabled={!canSave}
            onClick={onConfirm}
          >
            {pending
              ? "Attendere…"
              : mode === "close"
                ? "Registra uscita"
                : "Conferma annullamento"}
          </Button>
          <Button onClick={onClose} disabled={pending}>
            Indietro
          </Button>
        </div>
      </div>
    </div>
  );
}
