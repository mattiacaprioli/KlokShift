import { useState } from "react";
import type { Venue } from "@/features/venues/api";
import { useToast } from "../ui/Toast";
import { VenueEditDialog, type VenueEditTab } from "./VenueEditDialog";
import { VenueInfoCard } from "./VenueInfoCard";

/**
 * La scheda di una sede esistente: in **lettura**, e ogni sezione si apre con
 * il suo «Modifica» sulla scheda giusta del dialog.
 *
 * Fino al 21/09/2026 a chi aveva `can_manage_venue` la pagina apriva
 * direttamente il modulo: nome, indirizzo e logo — quello che i professionisti
 * vedono sui turni — si cambiavano con un tasto nel punto sbagliato. Il logo
 * sta dentro la modifica per lo stesso motivo: «Rimuovi» era a un clic.
 *
 * I permessi sono due e indipendenti: `editable` (dati e organico) e
 * `clockEditable` (timbratura e pausa, il permesso Ore).
 */
export function VenueCard({
  venue,
  editable,
  clockEditable = false,
}: {
  venue: Venue;
  editable: boolean;
  clockEditable?: boolean;
}) {
  const [editing, setEditing] = useState<VenueEditTab | null>(null);
  const toast = useToast();

  return (
    <>
      <VenueInfoCard
        venue={venue}
        canEditVenue={editable}
        canEditHours={clockEditable}
        onEdit={setEditing}
      />
      {editing && (editable || clockEditable) ? (
        <VenueEditDialog
          venue={venue}
          canManageVenue={editable}
          canManageHours={clockEditable}
          initialTab={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.show("Sede aggiornata");
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}
