import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Venue } from "@/features/venues/api";
import { cn } from "@/lib/cn";
import { UnsavedEdits } from "@/lib/unsavedEdits";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/primitives";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { BreakPolicyCard } from "./BreakPolicyCard";
import { ClockMethodCard } from "./ClockMethodCard";
import { PlanningVisibilityCard } from "./PlanningVisibilityCard";
import { VenueFormCard } from "./VenueFormCard";

type TabId = "dati" | "timbrature" | "pausa" | "organico";

/** Come la scheda staff: altezza stabile e form montati anche nei tab nascosti. */
export function VenueEditDialog({
  venue,
  canManageHours,
  onClose,
  onSaved,
}: {
  venue: Venue;
  canManageHours: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<TabId>("dati");
  const [dirtyKeys, setDirtyKeys] = useState<ReadonlySet<string>>(new Set());
  const [confirmClose, setConfirmClose] = useState(false);
  const reportUnsaved = useCallback((key: string, dirty: boolean) => {
    setDirtyKeys((previous) => {
      if (previous.has(key) === dirty) return previous;
      const next = new Set(previous);
      if (dirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const requestClose = useCallback(() => {
    if (dirtyKeys.size > 0) setConfirmClose(true);
    else onClose();
  }, [dirtyKeys, onClose]);

  const tabs: { id: TabId; label: string }[] = [
    { id: "dati", label: "Dati sede" },
    ...(canManageHours
      ? [
          { id: "timbrature" as const, label: "Timbrature" },
          { id: "pausa" as const, label: "Pausa" },
        ]
      : []),
    { id: "organico", label: "Organico" },
  ];
  const tab = tabs.some((item) => item.id === selected) ? selected : "dati";

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Un select aperto usa Esc per chiudere il proprio menu.
      if (event.defaultPrevented) return;
      if (event.key === "Escape" && !confirmClose) {
        event.preventDefault();
        requestClose();
      }
      if (event.key !== "Tab") return;
      const scope = confirmClose
        ? document.querySelector('[role="alertdialog"]')
        : dialogRef.current;
      const focusable = Array.from(
        scope?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
        ) ?? []
      ).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmClose, requestClose]);

  return createPortal(
    <UnsavedEdits.Provider value={reportUnsaved}>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
        <div className="absolute inset-0 bg-black/60" onClick={requestClose} aria-hidden />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal
          aria-labelledby={`${id}-title`}
          className="relative flex h-[min(90vh,52rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border-2 bg-bg-0"
        >
          <header className="flex shrink-0 items-start gap-4 px-6 pt-6">
            <Avatar url={venue.logo_url} name={venue.name} size={48} />
            <div className="min-w-0 flex-1">
              <h2 id={`${id}-title`} className="font-serif text-xl text-t1">Modifica sede</h2>
              <p className="mt-1 truncate text-sm text-t3">{venue.name}</p>
            </div>
            <Button onClick={requestClose}>Chiudi</Button>
          </header>

          <nav
            role="tablist"
            aria-label="Impostazioni della sede"
            className="mt-4 flex shrink-0 gap-1 overflow-x-auto border-b border-border px-6"
          >
            {tabs.map((item, index) => (
              <button
                key={item.id}
                id={`${id}-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                aria-controls={`${id}-panel-${item.id}`}
                tabIndex={tab === item.id ? 0 : -1}
                onClick={() => setSelected(item.id)}
                onKeyDown={(event) => {
                  let next: number;
                  if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
                  else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = tabs.length - 1;
                  else return;
                  event.preventDefault();
                  setSelected(tabs[next].id);
                  document.getElementById(`${id}-tab-${tabs[next].id}`)?.focus();
                }}
                className={cn(
                  "focus-gold -mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition",
                  tab === item.id
                    ? "border-gold font-semibold text-gold"
                    : "border-transparent text-t3 hover:text-t1"
                )}
              >
                {item.label}
                {item.id === "dati" && dirtyKeys.size > 0 ? " · Da salvare" : null}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {tabs.map((item) => (
              <div
                key={item.id}
                id={`${id}-panel-${item.id}`}
                role="tabpanel"
                aria-labelledby={`${id}-tab-${item.id}`}
                hidden={tab !== item.id}
                tabIndex={0}
                className={cn("focus-gold", tab !== item.id && "hidden")}
              >
                {item.id === "dati" ? <VenueFormCard venue={venue} embedded onSaved={onSaved} /> : null}
                {item.id === "timbrature" ? <ClockMethodCard venue={venue} embedded /> : null}
                {item.id === "pausa" ? <BreakPolicyCard venue={venue} embedded /> : null}
                {item.id === "organico" ? <PlanningVisibilityCard venue={venue} embedded /> : null}
              </div>
            ))}
          </div>
          <p className="shrink-0 border-t border-border px-6 py-4 text-xs leading-5 text-t3">
            I dati della sede si salvano con «Salva modifiche». Logo e impostazioni si salvano subito.
          </p>
        </div>
      </div>
      {confirmClose ? (
        <ConfirmDialog
          title="Modifiche non salvate"
          message="Hai cambiato i dati della sede senza salvarli. Se chiudi, queste modifiche vanno perse. Logo e impostazioni già salvati restano aggiornati."
          confirmLabel="Chiudi senza salvare"
          cancelLabel="Continua a modificare"
          destructive
          onConfirm={onClose}
          onCancel={() => {
            setConfirmClose(false);
            dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
          }}
        />
      ) : null}
    </UnsavedEdits.Provider>,
    document.body
  );
}
