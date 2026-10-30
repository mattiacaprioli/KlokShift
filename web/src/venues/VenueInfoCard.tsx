import {
  clockMethodDescription,
  clockMethodLabel,
} from "@/features/clock/methods";
import type { Venue } from "@/features/venues/api";
import { cn } from "@/lib/cn";
import { formatBreakMinutes } from "@/lib/format";
import type { ReactNode } from "react";
import { Avatar } from "../ui/Avatar";
import { Button, Card, Pill } from "../ui/primitives";
import type { VenueEditTab } from "./VenueEditDialog";

/**
 * La scheda di una sede **in lettura**, in due parti che rispecchiano le
 * schede di «Modifica»:
 *
 * - **la sede** — nome, logo, tipo, indirizzo, descrizione: quello che i
 *   dipendenti vedono sui turni (`can_manage_venue`);
 * - **come si lavora qui** — timbratura e pausa (permesso Ore) e planning per
 *   il team (`can_manage_venue`): regole che cambiano le ore e quello che
 *   vede lo staff, ognuna con la frase che ne dice l'effetto.
 *
 * Ogni sezione ha il suo «Modifica», che apre il dialog sulla scheda giusta.
 * Fino al 17/10/2026 c'era un solo «Modifica» per tutto e un elenco piatto
 * etichetta/valore; chi aveva il solo permesso Ore riceveva le card di
 * timbratura e pausa aggiunte in fondo alla pagina.
 *
 * ⚠️ Non è la difesa: quella sono le policy e le RPC. Qui si evita un modulo
 * che al salvataggio darebbe un errore illeggibile.
 */
export function VenueInfoCard({
  venue,
  canEditVenue,
  canEditHours,
  onEdit,
}: {
  venue: Venue;
  canEditVenue: boolean;
  canEditHours: boolean;
  onEdit: (tab: VenueEditTab) => void;
}) {
  const place = [venue.address, venue.city].filter(Boolean).join(", ");
  const ruleSet =
    venue.break_rule_after_minutes != null && venue.break_rule_minutes != null;

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <Card className="p-6">
        <div className="flex flex-wrap items-start gap-5">
          <Avatar url={venue.logo_url} name={venue.name} size={80} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-serif text-2xl text-t1">
              {venue.name}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-t2">
              {venue.cuisine_type ? <Pill>{venue.cuisine_type}</Pill> : null}
              {place ? (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <PinIcon />
                  <span className="truncate">{place}</span>
                </span>
              ) : canEditVenue ? (
                <AddLink onClick={() => onEdit("dati")}>
                  + Aggiungi l’indirizzo
                </AddLink>
              ) : null}
            </div>
          </div>
          {canEditVenue ? (
            <Button onClick={() => onEdit("dati")}>Modifica dati</Button>
          ) : null}
        </div>

        {venue.description ? (
          <p className="mt-5 whitespace-pre-wrap text-[15px] leading-6 text-t2">
            {venue.description}
          </p>
        ) : canEditVenue ? (
          <AddLink className="mt-5" onClick={() => onEdit("dati")}>
            + Aggiungi una descrizione
          </AddLink>
        ) : null}
      </Card>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-t3">
          Come si lavora qui
        </h3>
        <div className="grid gap-4 md:grid-cols-3">
          <RuleTile
            label="Timbratura"
            value={clockMethodLabel(venue.clock_method)}
            effect={clockMethodDescription(venue.clock_method)}
            onEdit={canEditHours ? () => onEdit("timbrature") : undefined}
            lockedHint="La cambia chi gestisce le ore."
          />
          <RuleTile
            label="Pausa"
            value={venue.break_paid ? "Retribuita" : "Non retribuita"}
            effect={
              venue.break_paid
                ? "Resta nelle ore lavorate."
                : "Si toglie dalle ore lavorate."
            }
            onEdit={canEditHours ? () => onEdit("pausa") : undefined}
            lockedHint="La cambia chi gestisce le ore."
          >
            <div className="mt-3 border-t border-border-2 pt-3 text-xs">
              <span className="text-t4">Pausa suggerita</span>
              {ruleSet ? (
                <p className="mt-0.5 text-t2">
                  {formatBreakMinutes(venue.break_rule_minutes!)} nei turni
                  oltre {formatBreakMinutes(venue.break_rule_after_minutes!)}
                </p>
              ) : canEditHours ? (
                <AddLink
                  className="mt-0.5 block"
                  onClick={() => onEdit("pausa")}
                >
                  + Imposta
                </AddLink>
              ) : (
                <p className="mt-0.5 text-t4">Non impostata</p>
              )}
            </div>
          </RuleTile>
          <RuleTile
            label="Turni visibili al team"
            value={
              venue.staff_sees_planning
                ? "Tutti i turni della sede"
                : "Solo i propri turni"
            }
            effect={
              venue.staff_sees_planning
                ? "Ogni persona vede anche i turni dei colleghi."
                : "Ogni persona vede solo i turni in cui è assegnata."
            }
            onEdit={canEditVenue ? () => onEdit("organico") : undefined}
            lockedHint="Lo cambia il titolare."
          />
        </div>
      </section>
    </div>
  );
}

function RuleTile({
  label,
  value,
  effect,
  onEdit,
  lockedHint,
  children,
}: {
  label: string;
  value: string;
  effect: string;
  onEdit?: () => void;
  lockedHint: string;
  children?: ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <span className="text-xs font-semibold uppercase tracking-wider text-gold">
        {label}
      </span>
      <p className="mt-2 font-serif text-lg leading-6 text-t1">{value}</p>
      <p className="mt-1 text-sm leading-5 text-t3">{effect}</p>
      {children}
      <div className="mt-auto pt-4">
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Modifica ${label.toLowerCase()}`}
            className="focus-gold rounded text-sm font-semibold text-gold transition hover:text-gold-light"
          >
            Modifica →
          </button>
        ) : (
          <p className="text-xs text-t4">{lockedHint}</p>
        )}
      </div>
    </Card>
  );
}

/** Un dato mancante, per chi può scriverlo, è un invito e non un «—». */
function AddLink({
  onClick,
  className,
  children,
}: {
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "focus-gold rounded text-sm text-gold transition hover:text-gold-light",
        className,
      )}
    >
      {children}
    </button>
  );
}

function PinIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4 shrink-0 text-t4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}
