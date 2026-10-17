import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { PersonOption } from "@/features/shifts/pastFilters";
import {
  selectedNames,
  selectionLabel,
  togglePerson,
} from "@/features/assignments/reportPeriod";
import { Button, Input } from "../ui/primitives";

/**
 * «Persone: Tutte» nella barra della pagina Ore: un clic apre l'elenco con le
 * caselle, per esportare una persona sola o un gruppo. `value` `null` = tutte.
 * L'elenco è quello di `peopleInReport`: chi nel periodo ha ore o assenze.
 */
export function PeopleSelect({
  options,
  value,
  onChange,
}: {
  options: PersonOption[];
  value: string[] | null;
  onChange: (ids: string[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const names = selectedNames(value, options);
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? options.filter((o) => o.name.toLowerCase().includes(needle))
    : options;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Button
        onClick={() => setOpen((o) => !o)}
        disabled={options.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn("h-full", value && "border-gold/60")}
      >
        <span className="text-t3">Persone:</span>
        <span className="max-w-[12rem] truncate">{selectionLabel(names)}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden
          className={cn("shrink-0 text-t3 transition", open && "rotate-180")}
        >
          <path d="m3 6 5 5 5-5" />
        </svg>
      </Button>

      {open ? (
        <div
          role="listbox"
          aria-multiselectable
          aria-label="Persone da includere"
          className="absolute left-0 top-full z-30 mt-2 flex max-h-96 w-72 flex-col rounded-xl border border-border-2 bg-bg-card p-2 shadow-xl"
        >
          {options.length > 8 ? (
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cerca una persona…"
              className="mb-2"
            />
          ) : null}
          <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold text-t1 hover:bg-bg-3">
            <input
              type="checkbox"
              className="accent-gold"
              checked={!value}
              onChange={() => onChange(null)}
            />
            Tutte
          </label>
          <div className="mt-1 overflow-y-auto border-t border-border pt-1">
            {shown.map((o) => (
              <label
                key={o.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-t2 hover:bg-bg-3"
              >
                <input
                  type="checkbox"
                  className="accent-gold"
                  checked={!!value?.includes(o.id)}
                  onChange={() =>
                    onChange(togglePerson(value, o.id, options.length))
                  }
                />
                <span className="truncate">{o.name}</span>
              </label>
            ))}
            {shown.length === 0 ? (
              <p className="px-2 py-2 text-xs text-t3">Nessuna persona trovata.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
