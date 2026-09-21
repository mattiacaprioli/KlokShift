import { createContext, useContext, useEffect } from "react";

/**
 * Le sezioni della scheda con modifiche non salvate.
 *
 * La scheda si apre in **lettura**: i dati di una persona si guardano molto più
 * spesso di quanto si cambino, e con i campi sempre aperti bastava un tasto
 * premuto nel punto sbagliato per riscrivere un nome o un contratto. Chi entra in
 * modifica lo dice qui, così chiudere la scheda (Esc, clic fuori, «Chiudi»)
 * chiede prima di buttare via il lavoro.
 *
 * Fuori dalla scheda il contesto non c'è e la segnalazione non fa niente.
 */
export const UnsavedEdits = createContext<
  (key: string, dirty: boolean) => void
>(() => {});

/** Segnala alla scheda che la sezione `key` ha modifiche non salvate. */
export function useUnsavedEdit(key: string, dirty: boolean) {
  const report = useContext(UnsavedEdits);
  useEffect(() => {
    report(key, dirty);
    return () => report(key, false);
  }, [report, key, dirty]);
}
