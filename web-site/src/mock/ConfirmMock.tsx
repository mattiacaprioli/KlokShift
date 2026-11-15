/*
 * Il lato dipendente: il turno assegnato che aspetta una risposta, e sotto
 * il monte ore. Le due sole cose che l'app gli chiede di fare — confermare e
 * guardare le proprie ore — nello stesso ordine in cui le trova nella home.
 *
 * È il venerdì di Sara della settimana del sito (`week.ts`): con `confirmed`
 * la risposta è già data, come dopo il tocco.
 */

export function ConfirmMock({ confirmed = false }: { confirmed?: boolean }) {
  return (
    <div className="px-3 pb-4 text-[0.78rem] leading-tight">
      <p className="px-1 font-serif text-[1.35em] font-semibold">Ciao, Sara</p>
      <p className="mt-1 mb-3 px-1 text-t3">
        {confirmed ? "Hai risposto a tutti i turni" : "La sede aspetta la tua risposta"}
      </p>

      <div
        className={`rounded-2xl border bg-bg-card p-3 transition-colors duration-500 ${
          confirmed ? "border-success/40" : "border-gold/40"
        }`}
      >
        <div className="flex items-center justify-between">
          <span
            className={`font-mono text-[0.8em] tracking-wider uppercase ${
              confirmed ? "text-success" : "text-gold"
            }`}
          >
            {confirmed ? "Confermato" : "Da confermare"}
          </span>
          <span className="text-[0.85em] text-t3">Sede Centro</span>
        </div>
        <p className="mt-2 text-[1.35em] font-bold tabular-nums">10:00 – 19:00</p>
        <p className="text-t2">Venerdì 20 novembre, Cassa</p>
        <div className="mt-3 flex gap-2">
          {confirmed ? (
            <span className="flex-1 rounded-full border border-success/40 py-2 text-center font-semibold text-success">
              Ci sarai
            </span>
          ) : (
            <>
              <span className="flex-1 rounded-full bg-gold py-2 text-center font-semibold text-gold-ink">
                Confermo
              </span>
              <span className="rounded-full border border-border-2 px-4 py-2 text-center text-t2">
                Non posso
              </span>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-border-2 bg-bg-card p-3">
        <p className="font-mono text-[0.8em] tracking-wider text-t3 uppercase">
          Le tue ore di novembre
        </p>
        <div className="mt-2 flex items-end justify-between">
          <span className="text-[1.6em] font-bold text-gold tabular-nums">61:15</span>
          <span className="text-t3">12 turni svolti</span>
        </div>
      </div>
    </div>
  );
}
