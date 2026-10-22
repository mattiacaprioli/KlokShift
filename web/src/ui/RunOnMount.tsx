import { useEffect } from "react";

/**
 * Esegue `run` una volta sola, al montaggio. Per consumare un parametro
 * dell'URL (`?nuovo=oggi`, `?aggiungi=1`), come `DeepLinkedShift` fa con
 * `?shift=`: chi lo monta toglie il parametro in `run`, e così lo smonta.
 */
export function RunOnMount({ run }: { run: () => void }) {
  useEffect(() => {
    run();
    // Una volta sola: l'identità di `run` cambia a ogni render del genitore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
