import { addDaysToDate, todayString } from "@/lib/format";
import type { VenueRole } from "@/features/roles/api";

/**
 * I filtri dello storico turni, condivisi da app e dashboard.
 *
 * ⚠️ **Sono filtri di query, non di vista.** Lo storico è paginato: filtrare le
 * righe *dopo* averle ricevute (com'erano i chip di sede nell'agenda) accorcia
 * le pagine, e lo scroll infinito legge una pagina corta come «finito» e
 * tronca la lista. Ogni voce qui dentro finisce in un `.filter()` PostgREST —
 * vedi `getOwnerPastShiftsPage` — e nella chiave di cache via
 * `pastFiltersKey()`, così due filtri diversi non si sovrascrivono in cache.
 *
 * Nessun import di React o React Native: la dashboard web lo riusa verbatim.
 */

/** Concluso o annullato: lo stato del turno passato. */
export type PastShiftStatus = "all" | "done" | "cancelled";

/** Un ruolo come lo sceglie chi filtra: un nome, e gli id che lo portano. */
export type RoleOption = {
  name: string;
  /**
   * Gli id di `venue_roles` con questo nome. Più di uno quando l'azienda ha più
   * sedi: "Barman" a Roma e "Barman" a Milano sono due righe distinte, ma chi
   * filtra ne cerca una sola — il mestiere, non la riga di configurazione.
   */
  ids: string[];
};

export type PastShiftsFilters = {
  /** Le sedi da includere. `null` = tutte quelle dell'azienda. */
  venueIds: string[] | null;
  /** Estremi inclusi, date DB (`YYYY-MM-DD`). `null` = senza limite da quel lato. */
  from: string | null;
  to: string | null;
  status: PastShiftStatus;
  role: RoleOption | null;
  /** Ricerca sul titolo del turno. Vuota = nessuna ricerca. */
  q: string;
};

/** Lo storico senza filtri: quello che vede chi apre la schermata. */
export const NO_PAST_FILTERS: PastShiftsFilters = {
  venueIds: null,
  from: null,
  to: null,
  status: "all",
  role: null,
  q: "",
};

/**
 * Il testo di ricerca ripulito dai caratteri che PostgREST interpreta.
 *
 * `%` e `_` sono i jolly di `ilike` e `ilike` non ha `ESCAPE` via API; virgole
 * e parentesi spezzano la sintassi dei filtri. Si tolgono invece di scappare:
 * chi cerca "Capodanno" non sta cercando una wildcard, e una query che torna
 * risultati sbagliati è peggio di una che ignora un carattere.
 */
export function normalizeQuery(q: string): string {
  return q.replace(/[%_,()*\\"']/g, " ").trim();
}

/** `true` se almeno un filtro restringe lo storico. */
export function hasPastFilters(f: PastShiftsFilters): boolean {
  return activePastFilterCount(f) > 0;
}

/** Quanti filtri sono accesi: è il numerino sul bottone «Filtri». */
export function activePastFilterCount(f: PastShiftsFilters): number {
  let n = 0;
  if (f.venueIds) n++;
  if (f.from || f.to) n++;
  if (f.status !== "all") n++;
  if (f.role) n++;
  if (normalizeQuery(f.q)) n++;
  return n;
}

/**
 * La porzione di query key che descrive i filtri. Stabile: gli array si
 * ordinano, il testo passa dalla stessa normalizzazione della query — così
 * "  Capodanno " e "Capodanno" sono la stessa pagina in cache.
 */
export function pastFiltersKey(f: PastShiftsFilters): string {
  return [
    f.venueIds ? [...f.venueIds].sort().join("+") : "all",
    f.from ?? "",
    f.to ?? "",
    f.status,
    f.role ? [...f.role.ids].sort().join("+") : "",
    normalizeQuery(f.q).toLowerCase(),
  ].join("|");
}

/**
 * I ruoli delle sedi raggruppati per nome, in ordine alfabetico.
 *
 * Il filtro è per mestiere e non per riga: con tre sedi ci sono tre "Cameriere"
 * diversi in `venue_roles`, e un elenco che li ripete tre volte chiede
 * all'utente di sapere cose che non gli interessano.
 */
export function groupRolesByName(roles: VenueRole[]): RoleOption[] {
  const byName = new Map<string, RoleOption>();
  for (const r of roles) {
    const key = r.name.trim();
    if (!key) continue;
    const found = byName.get(key.toLowerCase());
    if (found) found.ids.push(r.id);
    else byName.set(key.toLowerCase(), { name: key, ids: [r.id] });
  }
  return [...byName.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "it")
  );
}

/** I periodi pronti. `custom` esiste solo dove si possono scegliere le date. */
export type PeriodPresetId =
  | "all"
  | "last30"
  | "month"
  | "prevMonth"
  | "year"
  | "custom";

export const PERIOD_PRESETS: { id: PeriodPresetId; label: string }[] = [
  { id: "all", label: "Sempre" },
  { id: "last30", label: "Ultimi 30 giorni" },
  { id: "month", label: "Questo mese" },
  { id: "prevMonth", label: "Mese scorso" },
  { id: "year", label: "Quest'anno" },
];

/** Il primo giorno del mese di `date`, spostato di `offset` mesi. */
function monthStart(date: string, offset = 0): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

/** L'intervallo di un preset, o `null` per «sempre». */
export function periodRange(
  id: PeriodPresetId,
  today: string = todayString()
): { from: string | null; to: string | null } | null {
  switch (id) {
    case "last30":
      return { from: addDaysToDate(today, -30), to: today };
    case "month":
      return { from: monthStart(today), to: today };
    case "prevMonth":
      return {
        from: monthStart(today, -1),
        // Il giorno prima dell'inizio di questo mese: l'ultimo del precedente,
        // senza dover sapere se il mese aveva 28, 30 o 31 giorni.
        to: addDaysToDate(monthStart(today), -1),
      };
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "all":
    case "custom":
      return null;
  }
}

/**
 * Quale preset descrive l'intervallo corrente. Serve a ridisegnare i chip dopo
 * un ricaricamento o una scelta manuale delle date: senza, l'intervallo giusto
 * resterebbe senza chip acceso.
 */
export function periodPresetOf(
  f: PastShiftsFilters,
  today: string = todayString()
): PeriodPresetId {
  if (!f.from && !f.to) return "all";
  for (const p of PERIOD_PRESETS) {
    const r = periodRange(p.id, today);
    if (r && r.from === f.from && r.to === f.to) return p.id;
  }
  return "custom";
}
