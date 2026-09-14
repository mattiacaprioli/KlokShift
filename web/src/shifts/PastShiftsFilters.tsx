import {
  NO_PAST_FILTERS,
  PERIOD_PRESETS,
  activePastFilterCount,
  groupRolesByName,
  periodPresetOf,
  periodRange,
  type PastShiftStatus,
  type PastShiftsFilters as Filters,
  type PeriodPresetId,
} from "@/features/shifts/pastFilters";
import { useOwnerVenueRoles } from "@/features/roles/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { Button, Input, Select } from "../ui/primitives";

/**
 * La barra filtri dello storico.
 *
 * Ogni voce cambia la **query**, non la lista già a schermo: lo storico è
 * paginato, e un filtro applicato ai risultati mostrerebbe "3 turni" perché
 * solo 3 delle prime 20 righe passano il filtro, non perché ce ne siano 3.
 *
 * Senza stato proprio, nemmeno per il campo di ricerca: il testo digitato e i
 * filtri applicati sono due cose diverse (fra loro c'è l'attesa del debounce),
 * e tenerli in due posti vuol dire risincronizzarli a ogni azzeramento. Stanno
 * entrambi nella pagina.
 */
export function PastShiftsFilters({
  value,
  onChange,
  text,
  onTextChange,
}: {
  value: Filters;
  onChange: (next: Filters) => void;
  /** Il testo digitato, che diventa `value.q` dopo la pausa. */
  text: string;
  onTextChange: (next: string) => void;
}) {
  const { venues, isMultiVenue } = useOwnerVenues();
  const roles = groupRolesByName(useOwnerVenueRoles().data ?? []);
  const preset = periodPresetOf(value);
  const active = activePastFilterCount(value);

  const setPreset = (id: PeriodPresetId) => {
    const range = periodRange(id);
    onChange({ ...value, from: range?.from ?? null, to: range?.to ?? null });
  };

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3 print:hidden">
      <label className="flex min-w-56 flex-1 flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-t3">
          Cerca
        </span>
        <Input
          type="search"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder="Titolo del turno…"
        />
      </label>

      {isMultiVenue ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-t3">
            Locale
          </span>
          <Select
            value={value.venueIds?.[0] ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                venueIds: e.target.value ? [e.target.value] : null,
              })
            }
          >
            <option value="">Tutti i locali</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </label>
      ) : null}

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-t3">
          Periodo
        </span>
        <Select
          value={preset}
          onChange={(e) => setPreset(e.target.value as PeriodPresetId)}
        >
          {PERIOD_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          {/* Compare solo quando le date sono state scelte a mano: è uno stato,
              non una voce da scegliere — sceglierla non saprebbe che intervallo
              applicare. */}
          {preset === "custom" ? (
            <option value="custom">Personalizzato</option>
          ) : null}
        </Select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-t3">
          Dal
        </span>
        <Input
          type="date"
          value={value.from ?? ""}
          max={value.to ?? undefined}
          onChange={(e) => onChange({ ...value, from: e.target.value || null })}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-t3">
          Al
        </span>
        <Input
          type="date"
          value={value.to ?? ""}
          min={value.from ?? undefined}
          onChange={(e) => onChange({ ...value, to: e.target.value || null })}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-t3">
          Stato
        </span>
        <Select
          value={value.status}
          onChange={(e) =>
            onChange({ ...value, status: e.target.value as PastShiftStatus })
          }
        >
          <option value="all">Tutti</option>
          <option value="done">Conclusi</option>
          <option value="cancelled">Annullati</option>
        </Select>
      </label>

      {roles.length > 0 ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-t3">
            Ruolo
          </span>
          <Select
            value={value.role?.name ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                role: roles.find((r) => r.name === e.target.value) ?? null,
              })
            }
          >
            <option value="">Tutti i ruoli</option>
            {roles.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </Select>
        </label>
      ) : null}

      {active > 0 ? (
        <Button
          onClick={() => {
            onTextChange("");
            onChange(NO_PAST_FILTERS);
          }}
        >
          Azzera i filtri
        </Button>
      ) : null}
    </div>
  );
}
