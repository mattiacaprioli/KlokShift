import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";

export type IncomingNotification = {
  title?: string;
  type?: string;
  related_id?: string | null;
};

/**
 * Domini da rinfrescare quando arriva una notifica di quel tipo.
 *
 * È il canale notifiche a tenere aggiornato il professionista: essendo
 * filtrato per `user_id`, riceve solo ciò che lo riguarda davvero. Prima
 * `RealtimeSync` sottoscriveva `shifts`, `shift_assignments` e `staff_members`
 * senza filtro per ottenere lo stesso risultato, svegliando ogni client a ogni
 * modifica della piattaforma. La notifica c'è già: usarla come segnale costa
 * zero sottoscrizioni in più.
 *
 * `new_message` manca di proposito: la lista chat e il badge li aggiorna il
 * canale su `messages`, che porta anche il contenuto.
 */
const DOMAINS_BY_TYPE: Record<string, readonly (readonly unknown[])[]> = {
  shift_assigned: [qk.assignments.all],
  shift_unassigned: [qk.assignments.all],
  shift_cancelled: [qk.assignments.all, qk.shifts.all],
  shift_updated: [qk.assignments.all, qk.shifts.all],
  staff_invite: [qk.staff.all],
  staff_response: [qk.staff.all],
  staff_removed: [qk.staff.all, qk.assignments.all],
  // Le due facce di una richiesta di cambio turno. La chat la aggiorna già il
  // canale su `messages`: qui serve lo stato della richiesta (la card cambia
  // bottoni) e, sull'esito, le assegnazioni — approvare sposta il turno.
  shift_change_request: [qk.changeRequests.all],
  shift_change_response: [qk.changeRequests.all, qk.assignments.all],
  shift_declined: [qk.assignments.all],
};

/**
 * Canale realtime delle notifiche dell'utente: invalida le query a ogni
 * cambiamento e segnala i nuovi arrivi tramite `onNotify`.
 *
 * Headless — la usano sia `NotificationsListener` (React Native, toast di
 * `@/providers/Toast`) sia la dashboard web, che ha un proprio toast. Il
 * chiamante passa il percorso corrente perché la regola "niente avviso se stai
 * già leggendo quella conversazione" deve valere su entrambi: le due rotte hanno
 * per fortuna la stessa forma (`/chat/<id>`).
 */
export function useNotificationsRealtime({
  userId,
  currentPath,
  onNotify,
}: {
  userId: string;
  currentPath: string;
  onNotify: (notification: IncomingNotification) => void;
}) {
  // Ref per non ricreare il canale a ogni navigazione o re-render.
  const pathRef = useRef(currentPath);
  useEffect(() => {
    pathRef.current = currentPath;
  }, [currentPath]);

  const notifyRef = useRef(onNotify);
  useEffect(() => {
    notifyRef.current = onNotify;
  }, [onNotify]);

  const qc = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          qc.invalidateQueries({ queryKey: qk.notifications.all });
          if (payload.eventType !== "INSERT") return;
          const n = payload.new as IncomingNotification;
          // Una notifica nuova segnala che è cambiato qualcosa nel suo dominio.
          for (const queryKey of DOMAINS_BY_TYPE[n.type ?? ""] ?? []) {
            qc.invalidateQueries({ queryKey });
          }
          // Se stai già leggendo quella conversazione, niente avviso.
          const inThisChat =
            n.type === "new_message" &&
            !!n.related_id &&
            pathRef.current === `/chat/${n.related_id}`;
          if (n.title && !inThisChat) notifyRef.current(n);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, qc]);
}
