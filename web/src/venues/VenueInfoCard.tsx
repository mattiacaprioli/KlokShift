import type { Venue } from "@/features/venues/api";
import { Avatar } from "../ui/Avatar";
import { Card } from "../ui/primitives";

/**
 * La scheda di una sede **in sola lettura**.
 *
 * Il gemello senza campi di `VenueFormCard`, per chi la sede la vede ma non la
 * scrive: un collaboratore invitato sui turni sa dove lavora — indirizzo e
 * descrizione gli servono — ma i dati della sede sono un permesso a sé
 * (`can_manage_venue`).
 *
 * ⚠️ Non è la difesa: quella è la policy `venues: owner crud`, che accetta
 * scritture dal solo proprietario. Qui si evita un modulo che al salvataggio
 * darebbe un errore illeggibile — o, peggio, il logo: quell'update non passa da
 * `.select()`, quindi senza permessi non scrive niente e non fallisce nemmeno,
 * e la dashboard diceva «Logo aggiornato» su una sede rimasta com'era.
 */
export function VenueInfoCard({ venue }: { venue: Venue }) {
  const rows: [string, string | null][] = [
    ["Città", venue.city],
    ["Indirizzo", venue.address],
    ["Tipo di sede", venue.cuisine_type],
  ];

  return (
    <Card className="max-w-2xl">
      <div className="flex items-center gap-4">
        <Avatar url={venue.logo_url} name={venue.name} size={72} />
        <div className="min-w-0">
          <p className="truncate font-serif text-xl text-t1">{venue.name}</p>
          <p className="mt-0.5 text-xs text-t4">
            I dati della sede li cambia il titolare.
          </p>
        </div>
      </div>

      <dl className="mt-4 flex flex-col gap-2 border-t border-border-2 pt-4">
        {rows
          .filter(([, value]) => !!value)
          .map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-4">
              <dt className="text-xs uppercase tracking-wider text-t4">
                {label}
              </dt>
              <dd className="min-w-0 truncate text-sm text-t2">{value}</dd>
            </div>
          ))}
      </dl>

      {venue.description ? (
        <p className="mt-3 text-sm leading-5 text-t2">{venue.description}</p>
      ) : null}
    </Card>
  );
}
