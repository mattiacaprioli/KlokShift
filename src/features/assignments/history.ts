import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import {
  WORK_HISTORY_PAGE_SIZE,
  getMyWorkHistoryPage,
  getMyWorkHistoryRange,
  getMyWorkHistoryTotals,
  getMyWorkTotals,
  type WorkClockEdit,
  type WorkHistoryRow,
  type WorkHistoryCursor,
  type WorkHoursSource,
  type WorkPendingReason,
} from "./api";

export type WorkHistoryItem = {
  key: string;
  venueName: string;
  logoUrl: string | null;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  hours: number;
  shiftId: string;
  roleName: string | null;
  plannedHours: number;
  /** Solo quando `source` è `approved` o `adjusted`. */
  workedHours: number | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  /** Le ore proposte dalla timbratura chiusa, pausa compresa. */
  proposedHours: number | null;
  /** Null = non si sa (database non migrato): meglio tacere che indovinare. */
  source: WorkHoursSource | null;
  /**
   * Conta per la sede (stessa regola del riepilogo Ore). `false` = le ore sono
   * in attesa, e `pendingReason` dice cosa manca. Null = database non migrato.
   */
  counts: boolean | null;
  pendingReason: WorkPendingReason | null;
  clockEdit: WorkClockEdit | null;
  clockEditReason: string | null;
};

/** Le ore di una riga in attesa: non contano finché la sede non sistema. */
function isPending(item: Pick<WorkHistoryItem, "counts">): boolean {
  return item.counts === false;
}

/**
 * I totali dello storico: turni svolti, ore che contano e ore in attesa.
 *
 * La schermata Profilo mostra solo questi, e prima per averli scaricava
 * l'intera storia dei turni con sede annidata, per poi contarla in memoria.
 */
export function useMyWorkHistoryTotals(waiterId: string, enabled = true) {
  const query = useQuery({
    queryKey: qk.assignments.workHistoryTotals(waiterId),
    queryFn: getMyWorkHistoryTotals,
    enabled: !!waiterId && enabled,
  });
  return {
    count: query.data?.total_count ?? 0,
    totalHours: query.data?.total_hours ?? 0,
    pendingHours: query.data?.pending_hours ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

function toItem(r: WorkHistoryRow): WorkHistoryItem {
  return {
    key: r.key,
    venueName: r.venue_name ?? "Sede",
    logoUrl: r.logo_url,
    title: r.title,
    date: r.date,
    start_time: r.start_time,
    end_time: r.end_time,
    hours: r.hours,
    shiftId: r.shift_id,
    roleName: r.role_name,
    plannedHours: r.planned_hours,
    workedHours: r.worked_hours,
    clockInAt: r.clock_in_at,
    clockOutAt: r.clock_out_at,
    proposedHours: r.proposed_hours ?? null,
    source: r.hours_source,
    counts: r.counts,
    pendingReason: r.pending_reason,
    clockEdit: r.clock_edit,
    clockEditReason: r.clock_edit_reason,
  };
}

/**
 * Lo storico di un periodo (settimana o mese), per intero: i totali sono la
 * somma di quello che è a schermo, perché a schermo c'è tutto. Le ore in attesa
 * stanno a parte, come nei totali del database.
 */
export function useMyWorkHistoryRange(
  waiterId: string,
  from: string,
  to: string,
  enabled = true
) {
  const query = useQuery({
    queryKey: qk.assignments.workHistoryRange(waiterId, from, to),
    queryFn: () => getMyWorkHistoryRange(from, to),
    enabled: !!waiterId && enabled,
  });
  const items = useMemo(() => (query.data ?? []).map(toItem), [query.data]);
  return {
    items,
    count: items.length,
    totalHours: items
      .filter((i) => !isPending(i))
      .reduce((sum, i) => sum + i.hours, 0),
    pendingHours: items
      .filter(isPending)
      .reduce((sum, i) => sum + i.hours, 0),
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/**
 * Turni svolti e ore su un periodo, fra tutte le aziende: i numeri del Profilo.
 * Il periodo lo sceglie chi guarda (settimana o mese, `periodRange`), come
 * nella home del titolare.
 */
export function useMyWorkTotals(waiterId: string, from: string, to: string) {
  const query = useQuery({
    queryKey: qk.assignments.workTotals(waiterId, from, to),
    queryFn: () => getMyWorkTotals(from, to),
    enabled: !!waiterId,
  });
  return {
    count: query.data?.total_count ?? 0,
    totalHours: query.data?.total_hours ?? 0,
    pendingHours: query.data?.pending_hours ?? 0,
    isLoading: query.isLoading,
  };
}

/**
 * Storico dei turni svolti dal professionista, a pagine: le assegnazioni
 * passate non rifiutate né segnate come assenza. Solo ore lavorate, nessun dato
 * economico.
 *
 * L'ordinamento lo fa il database (`get_my_work_history`): erano
 * impossibili lato client senza scaricare tutto, perché si ordina per la data
 * del turno, che sta in una tabella collegata.
 */
export function useMyWorkHistory(waiterId: string, enabled = true) {
  const list = useInfiniteQuery({
    queryKey: qk.assignments.workHistory(waiterId),
    queryFn: ({ pageParam }) => getMyWorkHistoryPage(pageParam),
    initialPageParam: null as WorkHistoryCursor | null,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < WORK_HISTORY_PAGE_SIZE) return undefined;
      const last = lastPage[lastPage.length - 1];
      return { date: last.date, key: last.key };
    },
    enabled: !!waiterId && enabled,
  });

  const totals = useMyWorkHistoryTotals(waiterId, enabled);

  const items = useMemo<WorkHistoryItem[]>(
    () => (list.data?.pages ?? []).flat().map(toItem),
    [list.data]
  );

  return {
    items,
    // I totali coprono **tutto** lo storico, non solo le pagine caricate:
    // vengono da una query a parte, non dalla somma di ciò che è a schermo.
    totalHours: totals.totalHours,
    pendingHours: totals.pendingHours,
    count: totals.count,
    isLoading: list.isLoading || totals.isLoading,
    isError: list.isError || totals.isError,
    fetchNextPage: list.fetchNextPage,
    hasNextPage: list.hasNextPage,
    isFetchingNextPage: list.isFetchingNextPage,
    refetch: () => {
      list.refetch();
      totals.refetch();
    },
  };
}
