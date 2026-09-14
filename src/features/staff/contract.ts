import { formatHours } from "@/lib/format";

/**
 * Le ore che una persona **deve** fare, e il confronto con quelle programmate.
 *
 * Il contratto è della persona (`staff_people`), non della sede: chi lavora in
 * due locali dello stesso titolare ha un monte ore solo, ed è lo stesso motivo
 * per cui `computeWeekLoad` somma cross-sede.
 *
 * ⚠️ Non è un vincolo. Serve a colorare una cella del planning: nessuna
 * funzione qui dentro impedisce un'assegnazione, e il database non ha trigger
 * che leggano queste colonne. Ha sostituito le soglie 40h/48h di legge, che
 * erano uguali per tutti — e quindi mute su un part-time — e non sono
 * responsabilità del prodotto.
 */

/** Il periodo a cui si riferiscono le ore. Combacia con il check in DB. */
export type ContractPeriod = "day" | "week" | "month";

export type Contract = {
  hours: number;
  period: ContractPeriod;
};

export const CONTRACT_PERIODS: ContractPeriod[] = ["day", "week", "month"];

export const CONTRACT_PERIOD_LABEL: Record<ContractPeriod, string> = {
  day: "al giorno",
  week: "a settimana",
  month: "al mese",
};

/** Come si chiama il periodo quando è da solo su un chip. */
export const CONTRACT_PERIOD_SHORT: Record<ContractPeriod, string> = {
  day: "Giorno",
  week: "Settimana",
  month: "Mese",
};

/**
 * Il contratto di una persona, o `null` se non è stato registrato.
 *
 * Le due colonne vivono o cadono insieme (`staff_people_contract_pair_ck`), ma
 * qui si controllano entrambe lo stesso: il tipo generato le dà indipendenti, e
 * un'ora senza periodo non saprebbe come convertirsi.
 */
export function personContract(person: {
  contract_hours: number | null;
  contract_period: string | null;
}): Contract | null {
  const { contract_hours: hours, contract_period: period } = person;
  if (hours == null || period == null) return null;
  if (!isContractPeriod(period)) return null;
  return { hours, period };
}

export function isContractPeriod(value: string): value is ContractPeriod {
  return (CONTRACT_PERIODS as string[]).includes(value);
}

/** "40 h a settimana". */
export function formatContract(contract: Contract): string {
  return `${formatHours(contract.hours)} ${CONTRACT_PERIOD_LABEL[contract.period]}`;
}

/** Settimane in un mese medio: 52/12. Non 4, che sono 48 settimane l'anno. */
const WEEKS_PER_MONTH = 52 / 12;

/**
 * Il target **settimanale** con cui confrontare le ore di una settimana.
 *
 * - settimanale: le ore così come sono;
 * - mensile: diviso le settimane di un mese medio (173 h ≈ 40 h a settimana);
 * - giornaliero: moltiplicato per i giorni **programmati** in quella settimana,
 *   perché un contratto da 8 h al giorno non dice quanti giorni si lavora. Con
 *   zero giorni non c'è niente da confrontare, e la funzione torna `null`
 *   invece di un target da 0 h che colorerebbe di rosso una riga vuota.
 */
export function weeklyTarget(
  contract: Contract | null,
  daysWorked: number
): number | null {
  if (!contract) return null;
  switch (contract.period) {
    case "week":
      return contract.hours;
    case "month":
      return contract.hours / WEEKS_PER_MONTH;
    case "day":
      return daysWorked > 0 ? contract.hours * daysWorked : null;
  }
}

/**
 * Come stanno le ore programmate rispetto al target.
 *
 * `none` quando non c'è un contratto: la cella resta neutra, che è la risposta
 * onesta — senza target un numero di ore non è né alto né basso.
 */
export type LoadTone = "none" | "under" | "on" | "over";

/**
 * Mezz'ora di tolleranza: 39,5 su 40 non è un turno che manca, e colorare quella
 * riga vorrebbe dire colorarne quasi tutte.
 */
const TOLERANCE_HOURS = 0.5;

export function loadTone(hours: number, target: number | null): LoadTone {
  if (target == null) return "none";
  if (hours > target + TOLERANCE_HOURS) return "over";
  if (hours < target - TOLERANCE_HOURS) return "under";
  return "on";
}

/**
 * Da dove esce il target settimanale, quando non è il numero che il titolare ha
 * scritto: "173 h al mese ≈ 40 h a settimana". Torna `null` per i contratti
 * settimanali, dove non c'è niente da spiegare.
 */
export function targetExplainer(
  contract: Contract | null,
  target: number | null
): string | null {
  if (!contract || target == null || contract.period === "week") return null;
  return `${formatContract(contract)} ≈ ${formatHours(target)} a settimana`;
}
