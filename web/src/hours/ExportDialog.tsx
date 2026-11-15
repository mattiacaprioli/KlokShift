import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  EXPORT_BUTTON_LABEL,
  EXPORT_FORMATS,
  EXPORT_ISSUES_TITLE,
  EXPORT_ISSUE_LINKS,
  hiddenColumnsLabel,
  moreRowsLabel,
  nextFormat,
  unavailableNote,
  type ExportFormat,
  type ExportIssueTarget,
  type ExportPreview,
} from "@/features/assignments/exportPreview";
import { Button, Spinner } from "../ui/primitives";

/*
 * «Esporta per il consulente» sulla dashboard (spec
 * 2026-11-15-anteprima-export-design.md): si sceglie il file, si vedono i
 * totali, cosa resta fuori o va controllato e le prime righe del file, poi si
 * scarica. Presentazionale: dati e scarico li gestisce la pagina Ore, che legge
 * tutto una volta all'apertura. Gemello dell'app: `ExportSheet`.
 */


export function ExportDialog({
  subtitle,
  format,
  onFormat,
  state,
  preview,
  links,
  busy,
  onRetry,
  onDownload,
  onIssue,
  onClose,
}: {
  subtitle: string;
  format: ExportFormat;
  onFormat: (f: ExportFormat) => void;
  state: "loading" | "error" | "ready";
  /** Un'anteprima per formato: serve a spegnere quelli non disponibili. */
  preview: Record<ExportFormat, ExportPreview> | null;
  /** Quali voci portano un collegamento (`issueLinks`): le altre restano solo testo. */
  links: Record<ExportIssueTarget, boolean>;
  busy: boolean;
  onRetry: () => void;
  onDownload: () => void;
  onIssue: (t: ExportIssueTarget) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const current = preview?.[format] ?? null;
  const note = preview ? unavailableNote(preview) : null;

  // Un gruppo di scelte come i radio del browser: un solo punto di tabulazione,
  // e le frecce cambiano formato (saltando quelli spenti).
  const radios = useRef<Partial<Record<ExportFormat, HTMLButtonElement | null>>>({});
  function onRadioKey(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!preview || busy) return;
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    const next = nextFormat(format, dir, preview);
    onFormat(next);
    radios.current[next]?.focus();
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60" onClick={busy ? undefined : onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal
        aria-label={EXPORT_BUTTON_LABEL}
        className="relative flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border-2 bg-bg-card"
      >
        <div className="px-6 pt-6">
          <h2 className="font-serif text-lg text-t1">{EXPORT_BUTTON_LABEL}</h2>
          <p className="mt-1 text-sm text-t3">{subtitle}</p>
          <div role="radiogroup" aria-label="File" className="mt-4 flex flex-wrap gap-2">
            {EXPORT_FORMATS.map((f) => {
              const on = f.key === format;
              const off = preview ? !preview[f.key].available : false;
              return (
                <button
                  key={f.key}
                  ref={(el) => {
                    radios.current[f.key] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  onKeyDown={onRadioKey}
                  disabled={off || busy}
                  onClick={() => onFormat(f.key)}
                  className={`focus-gold rounded-xl border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    on ? "border-gold bg-gold/10 text-t1" : "border-border-2 text-t2 hover:border-border-gold"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          {note ? <p className="mt-2 text-xs text-t3">{note}</p> : null}
        </div>

        <div className="mt-4 flex-1 overflow-y-auto px-6 pb-2">
          {state === "loading" ? <Spinner label="Preparo il file…" /> : null}
          {state === "error" ? (
            <div className="rounded-xl border border-error/40 bg-error/10 px-4 py-3 text-sm text-t2">
              Export non riuscito. Riprova.
              <div className="mt-3">
                <Button onClick={onRetry}>Riprova</Button>
              </div>
            </div>
          ) : null}
          {state === "ready" && current ? (
            <>
              {current.totals.length > 0 ? (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {current.totals.map((t) => (
                    <div key={t.label} className="rounded-xl border border-border bg-bg-0 px-3 py-2">
                      <dt className="text-xs text-t3">{t.label}</dt>
                      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-t1">{t.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              {current.issues.length > 0 ? (
                <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3">
                  <p className="text-sm font-semibold text-warning">{EXPORT_ISSUES_TITLE}</p>
                  <ul className="mt-2 flex flex-col gap-2">
                    {current.issues.map((issue) => (
                      <li key={issue.target} className="flex items-start justify-between gap-4 text-sm text-t2">
                        <span>{issue.text}</span>
                        {links[issue.target] ? (
                          <button
                            type="button"
                            onClick={() => onIssue(issue.target)}
                            className="shrink-0 text-gold hover:underline"
                          >
                            {EXPORT_ISSUE_LINKS[issue.target]}
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {current.table ? (
                <div className="mt-4 overflow-x-auto rounded-xl border border-border">
                  <table className="w-full font-mono text-[11px]">
                    <thead>
                      <tr>
                        {current.table.header.map((h, i) => (
                          <th key={i} className="whitespace-nowrap border-b border-border bg-bg-0 px-2.5 py-2 text-left font-medium text-t3">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {current.table.rows.map((r, i) => (
                        <tr key={i}>
                          {r.map((cell, j) => (
                            <td key={j} className="whitespace-nowrap border-b border-border px-2.5 py-1.5 text-t1">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {current.table.more > 0 || current.table.hiddenColumns > 0 ? (
                    <p className="px-3 py-2 text-xs text-t3">
                      {[moreRowsLabel(current.table.more), hiddenColumnsLabel(current.table.hiddenColumns)]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <Button onClick={onClose} disabled={busy}>Annulla</Button>
          <Button
            variant="gold"
            onClick={onDownload}
            disabled={busy || state !== "ready" || !current?.available}
          >
            {format === "pdf" ? "Stampa" : "Scarica CSV"}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
