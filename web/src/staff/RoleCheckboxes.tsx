import { Link } from "react-router-dom";
import { useVenueRoles } from "@/features/roles/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";

type Props = {
  venueId: string;
  /** Id dei ruoli selezionati. */
  value: string[];
  onChange: (roleIds: string[]) => void;
};

/**
 * I ruoli di una persona dell'organico: scelta multipla sui ruoli della sede.
 * Caselle e non `<select>`: le mansioni sono poche e tutte visibili, e un
 * multi-select nativo da tastiera è uno dei controlli peggiori del web.
 *
 * Se la sede non ha ancora creato dei ruoli il campo non finge di essere
 * vuoto: porta dove si creano — ma solo a chi può crearli. Il listino si scrive
 * con il permesso 'venue', mentre qui arriva anche chi ha il solo organico: a
 * lei «Creali ora» aprirebbe una pagina dove il salvataggio viene rifiutato.
 */
export function RoleCheckboxes({ venueId, value, onChange }: Props) {
  const { data: roles = [], isPending } = useVenueRoles(venueId);
  const { can } = useOwnerVenues();

  if (isPending) {
    return <p className="text-xs text-t4">Caricamento ruoli…</p>;
  }

  if (roles.length === 0) {
    return can(venueId, "can_manage_venue") ? (
      <p className="text-xs text-t4">
        Nessun ruolo definito.{" "}
        <Link to="/ruoli" className="font-semibold text-gold">
          Creali ora
        </Link>
      </p>
    ) : (
      <p className="text-xs text-t4">
        Nessun ruolo definito per questa sede: può crearli chi ne gestisce i
        dati.
      </p>
    );
  }

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((r) => r !== id) : [...value, id]);
  }

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {roles.map((r) => (
        <label
          key={r.id}
          className="flex cursor-pointer items-center gap-2 text-sm text-t2"
        >
          <input
            type="checkbox"
            className="accent-gold"
            checked={value.includes(r.id)}
            onChange={() => toggle(r.id)}
          />
          {r.name}
        </label>
      ))}
    </div>
  );
}
