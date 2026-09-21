import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import {
  WORK_HISTORY_PAGE_SIZE,
  getMyWorkHistoryPage,
  getMyWorkHistoryTotals,
  getMyWorkTotals,
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
};

/**
 * I due totali dello storico: turni svolti e ore. Nient'altro.
 *
 * La schermata Profilo mostra solo questi, e prima per averli scaricava
 * l'intera storia dei turni con sede annidata, per poi contarla in memoria.
 */
export function useMyWorkHistoryTotals(waiterId: string) {
  const query = useQuery({
    queryKey: qk.assignments.workHistoryTotals(waiterId),
    queryFn: getMyWorkHistoryTotals,
    enabled: !!waiterId,
  });
  return {
    count: query.data?.total_count ?? 0,
    totalHours: query.data?.total_hours ?? 0,
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
export function useMyWorkHistory(waiterId: string) {
  const list = useInfiniteQuery({
    queryKey: qk.assignments.workHistory(waiterId),
    queryFn: ({ pageParam }) => getMyWorkHistoryPage(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < WORK_HISTORY_PAGE_SIZE ? undefined : allPages.length,
    enabled: !!waiterId,
  });

  const totals = useMyWorkHistoryTotals(waiterId);

  const items = useMemo<WorkHistoryItem[]>(
    () =>
      (list.data?.pages ?? []).flat().map((r) => ({
        key: r.key,
        venueName: r.venue_name ?? "Sede",
        logoUrl: r.logo_url,
        title: r.title,
        date: r.date,
        start_time: r.start_time,
        end_time: r.end_time,
        hours: r.hours,
      })),
    [list.data]
  );

  return {
    items,
    // I totali coprono **tutto** lo storico, non solo le pagine caricate:
    // vengono da una query a parte, non dalla somma di ciò che è a schermo.
    totalHours: totals.totalHours,
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
