import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";
import { useActiveVenue } from "@/features/venues/ActiveVenue";
import { useAuth } from "@/lib/auth";

/**
 * Testa della sidebar: chi sei e **in quale sede stai lavorando**.
 *
 * Con una sede sola rende esattamente il markup di prima — nome del locale e
 * email sotto — perché chi ne ha una non deve accorgersi che il multi-sede
 * esiste. Dalla seconda in poi diventa un pulsante con un popover.
 */
export function VenueSwitcher() {
  const { session, profile } = useAuth();
  const { venue, venues, setActiveVenue } = useActiveVenue();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Un popover che non si chiude cliccando fuori è un popover che resta aperto
  // mentre navighi, e copre la voce su cui stai andando.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const who = profile?.full_name ?? session?.user.email;
  const title = venue?.name ?? "topWaitr";

  if (venues.length <= 1) {
    return (
      <div className="mb-6 px-2">
        <div className="mb-3 h-1 w-8 rounded-full bg-gold" />
        <p className="font-serif text-lg leading-tight text-t1">{title}</p>
        <p className="mt-0.5 truncate text-xs text-t4">{who}</p>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative mb-6 px-2">
      <div className="mb-3 h-1 w-8 rounded-full bg-gold" />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="focus-gold -mx-1 flex w-full items-center gap-1.5 rounded-lg px-1 py-0.5 text-left transition hover:bg-bg-2"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-serif text-lg leading-tight text-t1">
            {title}
          </span>
          <span className="mt-0.5 block truncate text-xs text-t4">{who}</span>
        </span>
        <span
          aria-hidden
          className={cn(
            "shrink-0 text-t3 transition-transform",
            open && "rotate-180"
          )}
        >
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute left-2 right-2 top-full z-20 mt-1 overflow-hidden rounded-xl border border-border-2 bg-bg-card shadow-xl"
        >
          {venues.map((v) => {
            const active = v.id === venue?.id;
            return (
              <button
                key={v.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setActiveVenue(v.id);
                  setOpen(false);
                }}
                className={cn(
                  "focus-gold flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition",
                  active
                    ? "bg-gold/15 text-gold"
                    : "text-t2 hover:bg-bg-2 hover:text-t1"
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{v.name}</span>
                  {v.city ? (
                    <span className="block truncate text-xs text-t4">
                      {v.city}
                    </span>
                  ) : null}
                </span>
                {active ? <span aria-hidden>✓</span> : null}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate("/locale/nuovo");
            }}
            className="focus-gold w-full border-t border-border-2 px-3 py-2 text-left text-sm text-t3 transition hover:bg-bg-2 hover:text-t1"
          >
            + Aggiungi locale
          </button>
        </div>
      ) : null}
    </div>
  );
}
