import { useCallback, useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { shiftViewQueryKeys } from "@/features/shifts/invalidation";

type Row = Record<string, unknown>;
type Payload = RealtimePostgresChangesPayload<Row>;

/**
 * Quante sedi stanno in un solo filtro `in.(...)`. Oltre questa soglia si
 * aggiunge un binding, mai si toglie il filtro — vedi il commento nell'effetto.
 * Irraggiungibile nella pratica: esiste per impedire il fallback sbagliato.
 */
const REALTIME_FILTER_MAX = 50;

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
 * trigger che tiene i posti (`positions_filled`) ne aggiunge altrettanti su `shifts`. Senza
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
 * Le tabelle ascoltate: `shifts`, `shift_assignments`, `venue_members`,
 * `venue_member_roles`, `venue_roles` (tutte filtrate per `venue_id`),
 * `workspace_members` (per azienda, e per account: cambiano i permessi di chi
 * guarda) e `messages`. Le notifiche hanno il loro canale
 * (`useNotificationsRealtime`). `role` è la vista attiva, non un attributo
 * dell'account: decide solo quali canali aprire.
 *
 * Due principi, entrambi imparati risolvendo il Disk IO budget esaurito:
 *
 * 1. **Sottoscrivere il meno possibile.** Prima questo componente ascoltava
 *    `shifts` senza filtro, e ogni modifica di turno di *qualunque* sede
 *    svegliava *tutti* i client — Realtime valuta la RLS per ogni subscriber
 *    su ogni riga cambiata. Ora il ristoratore ascolta solo la propria sede e
 *    il professionista non ascolta `shifts` affatto: quello che lo riguarda gli
 *    arriva già dal canale notifiche, filtrato per `user_id` (vedi
 *    `useNotificationsRealtime`).
 *
 * 2. **Invalidare stretto.** Si invalidano le chiavi della sede/utente
 *    interessato, in una sola raffica raggruppata, invece di far cadere dalla
 *    cache ogni intervallo del planning, lo storico e ogni dettaglio turno.
 *
 * 3. **Un canale solo, con un filtro `in`.** Un titolare con tre sedi le ascolta
 *    tutte e tre da `venue_id=in.(a,b,c)` — l'operatore `in` è supportato dai
 *    filtri `postgres_changes` al pari di `eq`.
 *
 *    Ciò che aveva esaurito il Disk IO budget era il **numero di subscriber**: il
 *    server valuta la RLS per ogni subscriber su ogni riga cambiata, quindi tre
 *    canali `eq` costano tre volte. Con `in` il subscriber resta **uno**, e a
 *    crescere sono solo le righe che *matchano* — cioè esattamente gli eventi che
 *    la UI deve ricevere. Non è un compromesso: è meno lavoro di prima, quando la
 *    stessa copertura richiedeva di cambiare sede a mano.
 *
 *    ⚠️ Chi tocca questo effetto: la dipendenza è `venuesKey` (**stringa**), mai
 *    `venueIds`. Un array nuovo a ogni render smonterebbe e rimonterebbe il canale
 *    in continuazione — la tempesta di subscribe è il modo in cui si riesaurisce
 *    il budget. È anche ciò che fa rimontare il canale quando si apre una sede.
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
  // lettura in più. Per il professionista sono vuoti — lo sa il provider, non
  // serve spegnerlo da qui.
  // Solo `venuesKey`, non `venueIds`: vedi il punto 3 qui sopra. La stringa è la
  // stessa lista, ed è l'unica forma che si può mettere nelle dipendenze.
  const { workspaceId, venuesKey } = useOwnerVenues();

  useEffect(() => {
    if (!isManager || !workspaceId || venuesKey === "") return;

    // Dentro l'effetto, non fuori: `venueIds` è un array nuovo a ogni render e
    // nelle dipendenze rimonterebbe il canale in continuazione. La verità è
    // `venuesKey`, che è già la stessa lista ordinata.
    const ids = venuesKey.split(",");
    // Tetto di sicurezza: `VENUE_LIMIT` è `Infinity`, quindi la stringa del
    // filtro non ha un limite naturale. Oltre la soglia si **spezza in più
    // binding**, non si toglie il filtro: Realtime valuta la RLS per ogni
    // subscriber su ogni riga cambiata, e senza filtro il costo cresce con
    // l'attività di tutta la piattaforma invece che con la propria.
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += REALTIME_FILTER_MAX) {
      chunks.push(ids.slice(i, i + REALTIME_FILTER_MAX));
    }

    const channel = supabase.channel(`sync:owner:${workspaceId}`);

    for (const chunk of chunks) {
      const filter = `venue_id=in.(${chunk.join(",")})`;
      // Turni delle proprie sedi: il filtro server-side è la differenza fra
      // ricevere i propri eventi e riceverli tutti.
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shifts", filter },
        (payload) => {
          const shiftId = idOf(rowOf(payload), "id");
          for (const queryKey of shiftViewQueryKeys(shiftId)) {
            invalidate(queryKey);
          }
        }
      );
      // Organico: chi è in sede, con quali mansioni, e le mansioni stesse.
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "venue_members", filter },
        () => {
          invalidate(qk.staff.all);
        }
      );
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "venue_member_roles", filter },
        () => {
          invalidate(qk.staff.all);
          invalidate(qk.roles.all);
        }
      );
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "venue_roles", filter },
        () => {
          invalidate(qk.roles.all);
          // Il fabbisogno e il ruolo di ogni assegnazione portano il nome.
          invalidate(qk.shifts.rangeAny);
          invalidate(qk.shifts.byOwnerAll);
        }
      );
      // `shift_assignments` porta `venue_id`: si filtra come i turni.
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shift_assignments", filter },
        (payload) => {
          const shiftId = idOf(rowOf(payload), "shift_id");
          if (shiftId) {
            invalidate(qk.assignments.byShift(shiftId));
            invalidate(qk.shifts.detail(shiftId));
          } else {
            // DELETE: `old` porta solo l'id, il turno non si sa.
            invalidate(qk.assignments.all);
          }
          invalidate(qk.assignments.todayAll);
          // La copertura si legge dalle liste di turni: invalidare quelle basta.
          invalidate(qk.shifts.byOwnerAll);
          invalidate(qk.shifts.rangeAny);
          // Lo storico mostra le ore approvate e quelle ancora da approvare.
          invalidate(qk.shifts.pastAll);
          // Ore lavorate e performance dell'organico.
          invalidate(qk.staff.all);
        }
      );
      // Entrata e uscita cambiano `shift_clock_records`, non l'assegnazione:
      // senza questo evento il planning del titolare resterebbe senza avviso
      // finché non viene ricaricato a mano. La riga porta sia sede sia turno.
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shift_clock_records", filter },
        (payload) => {
          const row = rowOf(payload);
          const shiftId = idOf(row, "shift_id");
          if (shiftId) {
            invalidate(qk.assignments.byShift(shiftId));
            invalidate(qk.shifts.detail(shiftId));
          }
          invalidate(qk.assignments.todayAll);
          invalidate(qk.shifts.rangeAny);
          invalidate(qk.shifts.pastAll);
        }
      );
    }

    // Le persone dell'azienda: nuovi arrivi, inviti accettati, permessi.
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "workspace_members",
        filter: `workspace_id=eq.${workspaceId}`,
      },
      () => {
        invalidate(qk.staff.all);
        invalidate(qk.team.all);
      }
    );

    channel
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
  }, [isManager, workspaceId, venuesKey, invalidate]);

  // Cosa **io** posso fare e dove: cambia quando qualcuno accetta un invito,
  // mi toglie un permesso o mi mette in organico. Vale per ogni vista, quindi
  // non dipende da `role`. Il filtro per account tiene il subscriber leggero:
  // gli eventi che arrivano sono solo le mie righe.
  useEffect(() => {
    const channel = supabase
      .channel(`sync:me:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workspace_members",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          invalidate(qk.context.mine);
          invalidate(qk.venues.mine);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, invalidate]);

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
