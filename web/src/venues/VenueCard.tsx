import { useState } from "react";
import type { Venue } from "@/features/venues/api";
import { useToast } from "../ui/Toast";
import { VenueEditDialog } from "./VenueEditDialog";
import { VenueInfoCard } from "./VenueInfoCard";

/**
 * La scheda di una sede esistente: in **lettura**, e chi può scriverla la apre
 * con «Modifica».
 *
 * Fino al 21/09/2026 a chi aveva `can_manage_venue` la pagina apriva
 * direttamente il modulo: nome, indirizzo e logo — quello che i professionisti
 * vedono sui turni — si cambiavano con un tasto nel punto sbagliato. Il logo
 * sta dentro la modifica per lo stesso motivo: «Rimuovi» era a un clic.
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
  const [editing, setEditing] = useState(false);
  const toast = useToast();

  return (
    <>
      <VenueInfoCard
        venue={venue}
        onEdit={editable ? () => setEditing(true) : undefined}
      />
      {editable && editing ? (
        <VenueEditDialog
          venue={venue}
          canManageHours={clockEditable}
          onClose={() => setEditing(false)}
          onSaved={() => {
            toast.show("Sede aggiornata");
            setEditing(false);
          }}
        />
      ) : null}
    </>
  );
}
