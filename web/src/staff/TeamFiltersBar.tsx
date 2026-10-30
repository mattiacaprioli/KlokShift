import type { Venue } from "@/features/venues/api";
import {
  NO_TEAM_FILTERS,
  notInAppLabel,
  teamFiltersActive,
  type TeamFilters,
} from "@/features/staff/teamFilters";
import { cn } from "@/lib/cn";
import { Input, Select } from "../ui/primitives";

/**
 * Ricerca e filtri del team, come quelli dello storico: pochi, ciascuno solo
 * quando serve (la sede con più sedi, «Non ancora nell'app» se c'è qualcuno).
 * La logica è `features/staff/teamFilters.ts`, la stessa dell'app.
 */
export function TeamFiltersBar({
  value,
  onChange,
  venues,
  roles,
  notInAppCount,
}: {
  value: TeamFilters;
  onChange: (next: TeamFilters) => void;
  /** Le sedi aperte: con una sola il filtro non compare. */
  venues: Venue[];
  roles: { key: string; label: string }[];
  notInAppCount: number;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <label className="flex min-w-56 flex-1 flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-t3">Cerca</span>
        <Input
          type="search"
          value={value.query}
          onChange={(e) => onChange({ ...value, query: e.target.value })}
          placeholder="Nome o ruolo…"
        />
      </label>

      {venues.length > 1 ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-t3">Sede</span>
          <Select
            value={value.venueId ?? ""}
            onChange={(e) => onChange({ ...value, venueId: e.target.value || null })}
          >
            <option value="">Tutte le sedi</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </label>
      ) : null}

      {roles.length > 0 ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-t3">Ruolo</span>
          <Select
            value={value.role ?? ""}
            onChange={(e) => onChange({ ...value, role: e.target.value || null })}
          >
            <option value="">Tutti i ruoli</option>
            {roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </Select>
        </label>
      ) : null}

      {notInAppCount > 0 ? (
        <button
          type="button"
          aria-pressed={value.notInApp}
          onClick={() => onChange({ ...value, notInApp: !value.notInApp })}
          className={cn(
            "focus-gold h-10 rounded-xl border px-3 text-sm font-semibold transition",
            value.notInApp
              ? "border-gold bg-gold/10 text-gold"
              : "border-border-2 bg-bg-2 text-t2 hover:text-t1"
          )}
        >
          {notInAppLabel(notInAppCount)}
        </button>
      ) : null}

      {teamFiltersActive(value) ? (
        <button
          type="button"
          onClick={() => onChange(NO_TEAM_FILTERS)}
          className="focus-gold h-10 rounded-xl px-2 text-sm text-t3 hover:text-t1"
        >
          Azzera
        </button>
      ) : null}
    </div>
  );
}
