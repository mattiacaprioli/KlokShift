/*
 * Il lato professionista: il turno assegnato che aspetta una risposta, e sotto
 * il monte ore. Le due sole cose che l'app gli chiede di fare — confermare e
 * guardare le proprie ore — nello stesso ordine in cui le trova nella home.
 */

export function ConfirmMock() {
  return (
    <div className="px-3 pb-4 text-[0.78rem] leading-tight">
      <p className="px-1 font-serif text-[1.35em] font-semibold">Ciao, Sara</p>
      <p className="mt-1 mb-3 px-1 text-t3">La sede aspetta la tua risposta</p>

      <div className="rounded-2xl border border-gold/40 bg-bg-card p-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[0.8em] tracking-wider text-gold uppercase">
            Da confermare
          </span>
          <span className="text-[0.85em] text-t3">Osteria del Porto</span>
        </div>
        <p className="mt-2 text-[1.35em] font-bold tabular-nums">
          18:00 – 23:30
        </p>
        <p className="text-t2">Venerdì 19 settembre · Sala</p>
        <div className="mt-3 flex gap-2">
          <span className="flex-1 rounded-full bg-gold py-2 text-center font-semibold text-gold-ink">
            Confermo
          </span>
          <span className="rounded-full border border-border-2 px-4 py-2 text-center text-t2">
            Non posso
          </span>
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-border-2 bg-bg-card p-3">
        <p className="font-mono text-[0.8em] tracking-wider text-t3 uppercase">
          Le tue ore · settembre
        </p>
        <div className="mt-2 flex items-end justify-between">
          <span className="text-[1.6em] font-bold text-gold tabular-nums">
            61:15
          </span>
          <span className="text-t3">12 turni svolti</span>
        </div>
      </div>
    </div>
  );
}
