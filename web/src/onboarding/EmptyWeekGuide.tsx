import type { EmptyWeekGuide as Guide } from "@/features/onboarding/firstWeek";
import { Button, ButtonLink, noticeClass } from "../ui/primitives";

/*
 * La guida della settimana vuota: il passo che manca prima del primo turno, in
 * cima alla griglia dei Turni (vedi `emptyWeekGuide`). Sparisce al primo turno.
 * Con ruoli e persone che mancano si può comunque creare un turno: la guida
 * suggerisce l'ordine, non lo impone.
 */
const COPY: Record<Guide, { text: string; cta: string; to?: string }> = {
  roles: {
    text: "Prima scegli i ruoli (reception, cassa, magazzino…): ogni turno chiede un ruolo, e lo dai alle persone.",
    cta: "Aggiungi i ruoli",
    to: "/ruoli",
  },
  people: {
    text: "Ora aggiungi chi lavora con te: lo metti nei turni e riceve la notifica sul telefono.",
    cta: "Aggiungi le persone",
    to: "/staff?aggiungi=1",
  },
  shift: {
    text: "Scegli un giorno, l'orario e chi lavora: le persone ricevono la notifica quando pubblichi.",
    cta: "Crea il primo turno",
  },
};

export function EmptyWeekGuide({ guide, onCreate }: { guide: Guide; onCreate: () => void }) {
  const copy = COPY[guide];
  return (
    <div className={noticeClass("gold", "flex flex-wrap items-center justify-between gap-4")}>
      <div className="min-w-0 max-w-2xl">
        <p className="font-serif text-lg text-t1">La tua prima settimana</p>
        <p className="mt-1 text-sm leading-6 text-t2">{copy.text}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {copy.to ? (
          <>
            <button
              type="button"
              onClick={onCreate}
              className="focus-gold rounded text-sm text-t3 underline hover:text-t1"
            >
              Crea comunque un turno
            </button>
            <ButtonLink variant="gold" to={copy.to}>
              {copy.cta}
            </ButtonLink>
          </>
        ) : (
          <Button variant="gold" onClick={onCreate}>
            {copy.cta}
          </Button>
        )}
      </div>
    </div>
  );
}
