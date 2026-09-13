import { useCallback, useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { useActiveVenueId } from "@/features/venues/ActiveVenue";

type Row = Record<string, unknown>;
type Payload = RealtimePostgresChangesPayload<Row>;

/**
 * La riga toccata dall'evento. Attenzione: la replica identity è quella di
 * default (solo la chiave primaria), quindi su DELETE `old` contiene **solo
 * l'id** — nessuna foreign key. Chi legge un campo diverso da `id` deve avere
 * un fallback più largo per quel caso.
 */
function rowOf(payload: Payload): Row {
  const next = payload.new as Row | undefined;
  if (next && Object.keys(next).length > 0) return next;
  return (payload.old as Row | undefined) ?? {};
}

function idOf(row: Row, field: string): string | undefined {
  const value = row[field];
  return typeof value === "string" ? value : undefined;
}

/**
 * Raggruppa le invalidazioni in una sola raffica.
 *
 * Serve perché i trigger del database moltiplicano gli eventi: assegnare 10
 * persone a un turno produce 10 eventi su `shift_assignments`, e il trigger
 * `sync_internal_positions_filled` ne aggiunge altrettanti su `shifts`. Senza
 * debounce erano 20 giri di refetch per un'azione sola.
 */
function useBurstInvalidate(qc: QueryClient, ms = 300) {
  const pending = useRef(new Map<string, readonly unknown[]>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    timer.current = null;
    const keys = [...pending.current.values()];
    pending.current.clear();
    for (const queryKey of keys) qc.invalidateQueries({ queryKey });
  }, [qc]);

  useEffect(() => {
    // Catturati qui: la cleanup non deve leggere `.current` al momento in cui gira.
    const timerRef = timer;
    const pendingKeys = pending.current;
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingKeys.clear();
    };
  }, []);

  // Le chiavi ripetute nella stessa finestra collassano in una (chiave = JSON).
  return useCallback(
    (queryKey: readonly unknown[]) => {
      pending.current.set(JSON.stringify(queryKey), queryKey);
      if (timer.current == null) timer.current = setTimeout(flush, ms);
    },
    [flush, ms]
  );
}

/**
 * Listener realtime app-wide per il dominio turni/organico. Nessuna UI.
 *
 * Due principi, entrambi imparati risolvendo il Disk IO budget esaurito:
 *
 * 1. **Sottoscrivere il meno possibile.** Prima questo componente ascoltava
 *    `shifts` senza filtro, e ogni modifica di turno di *qualunque* locale
 *    svegliava *tutti* i client — Realtime valuta la RLS per ogni subscriber
 *    su ogni riga cambiata. Ora il ristoratore ascolta solo il proprio locale e
 *    il professionista non ascolta `shifts` affatto: quello che lo riguarda gli
 *    arriva già dal canale notifiche, filtrato per `user_id` (vedi
 *    `useNotificationsRealtime`).
 *
 * 2. **Invalidare stretto.** Si invalidano le chiavi del locale/utente
 *    interessato, in una sola raffica raggruppata, invece di far cadere dalla
 *    cache ogni intervallo del planning, lo storico e ogni dettaglio turno.
 *
 * 3. **Si ascolta la sede attiva, non tutte.** Un titolare con tre sedi ha un
 *    canale solo: `venueId` viene dallo switcher, e le dipendenze dell'effetto
 *    smontano il canale della sede precedente e ne aprono uno sulla nuova da sé.
 *    Sottoscriverne tre moltiplicherebbe per tre la valutazione RLS di ogni riga
 *    cambiata — esattamente ciò che ha esaurito il Disk IO budget la prima volta.
 *    Chi torna su una sede vede subito la cache (le chiavi non sono state
 *    invalidate, solo lasciate stale) e il refetch gira in background.
 */
export function RealtimeSync({
  userId,
  role,
}: {
  userId: string;
  role: "waiter" | "manager";
}) {
  const qc = useQueryClient();
  const invalidate = useBurstInvalidate(qc);
  const isManager = role === "manager";

  // Stessa sorgente delle schermate del ristoratore: è un context, non una
  // lettura in più. Per il professionista è `undefined` — lo sa il provider, non
  // serve spegnerlo da qui.
  const venueId = useActiveVenueId();

  useEffect(() => {
    if (!isManager || !venueId) return;

    const channel = supabase
      .channel(`sync:venue:${venueId}`)
      // Turni del proprio locale: il filtro server-side è la differenza fra
      // ricevere i propri eventi e riceverli tutti.
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "shifts",
          filter: `venue_id=eq.${venueId}`,
        },
        (payload) => {
          const shiftId = idOf(rowOf(payload), "id");
          if (shiftId) invalidate(qk.shifts.detail(shiftId));
          invalidate(qk.shifts.byVenue(venueId));
          invalidate(qk.shifts.rangeAll(venueId));
          invalidate(qk.shifts.past(venueId));
          invalidate(qk.shifts.pastCount(venueId));
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shift_assignments" },
        (payload) => {
          const shiftId = idOf(rowOf(payload), "shift_id");
          if (shiftId) {
            invalidate(qk.assignments.byShift(shiftId));
            invalidate(qk.shifts.detail(shiftId));
          } else {
            // DELETE: `old` porta solo l'id, il turno non si sa.
            invalidate(qk.assignments.all);
          }
          invalidate(qk.assignments.today(venueId));
          // La copertura si legge dalle liste di turni: invalidare quelle basta.
          invalidate(qk.shifts.byVenue(venueId));
          invalidate(qk.shifts.rangeAll(venueId));
          // Ore lavorate e performance dell'organico.
          invalidate(qk.staff.all);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "staff_members",
          filter: `venue_id=eq.${venueId}`,
        },
        () => {
          invalidate(qk.staff.byVenue(venueId));
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => {
          invalidate(qk.chat.conversationsAll);
          invalidate(qk.chat.unreadAll);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isManager, venueId, invalidate]);

  useEffect(() => {
    if (isManager) return;

    const channel = supabase
      .channel(`sync:waiter:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => {
          invalidate(qk.chat.conversationsAll);
          invalidate(qk.chat.unreadAll);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isManager, userId, invalidate]);

  return null;
}
