import { useEffect, useState } from "react";

/**
 * L'ora corrente, aggiornata a intervalli: per le etichette che cambiano col
 * passare del tempo («In ritardo» scatta a un'ora precisa) senza rifare query.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
