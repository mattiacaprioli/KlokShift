import { Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { Mono } from "@/components/ui/Mono";
import { Pill } from "@/components/ui/Pill";
import { cn } from "@/lib/cn";
import {
  formatDayLabel,
  formatHours,
  formatTime,
  isOvernightShift,
  shiftDurationHours,
} from "@/lib/format";
import type { ShiftWithVenue } from "@/features/shifts/types";
import type { Enums } from "@/types/database";

type AssignmentStatus = Enums<"assignment_status">;

/**
 * Lo stato di un turno si legge dalla barra colorata a sinistra, non da
 * un'etichetta: la Pill costava un terzo della larghezza della card e su uno
 * schermo da 375pt troncava sia il nome della sede sia il ruolo. Resta solo
 * dove dice qualcosa che il colore non dice — un turno rifiutato o un'assenza.
 *
 * Gli stessi tre colori del lato sede (vedi `shiftTone`), letti però sul
 * **proprio** stato invece che sulla copertura: verde a posto, arancio c'è da
 * fare qualcosa, spento fuori gioco. Fino al 14/09/2026 un turno confermato era
 * oro e uno da confermare arancio — #EAB54C contro #E2922F, due ambre che su un
 * telefono al sole sono lo stesso colore — e il verde c'era solo nella Pill del
 * dettaglio turno, che quindi diceva un'altra cosa.
 */
const STATUS: Record<
  AssignmentStatus,
  { bar: string; pill?: { label: string; variant: "cancelled" } }
> = {
  confirmed: { bar: "bg-success" },
  assigned: { bar: "bg-warning" },
  declined: {
    bar: "bg-t4",
    pill: { label: "Rifiutato", variant: "cancelled" },
  },
  no_show: { bar: "bg-t4", pill: { label: "Assente", variant: "cancelled" } },
};

/**
 * Un turno assegnato, visto dal professionista.
 *
 * La data non c'è: la porta l'intestazione del giorno in agenda. Ripeterla in
 * fondo a ogni card rendeva dieci turni dieci righe uguali, e spingeva l'ora —
 * la sola cosa che si cerca davvero — in fondo alla gerarchia. Qui l'ora è
 * l'elemento più forte, in cifre tabellari così che le righe si incolonnino.
 *
 * Niente compenso: sui turni interni `hourly_rate` non è un dato che la sede
 * espone al professionista, ed è per questo che anche il dettaglio turno
 * (`(waiter)/shift/[id]`) non mostra la riga "Compenso".
 */
export function MyShiftCard({
  shift,
  status,
  role,
  onPress,
  variant = "agenda",
  onConfirm,
  onDecline,
  pending,
  absenceNote,
}: {
  shift: ShiftWithVenue;
  status: AssignmentStatus;
  /** Il ruolo per cui è chiamato quel giorno, se la sede l'ha scelto. */
  role?: string | null;
  onPress: () => void;
  /** `compact` sta in una riga sola e porta il giorno con sé: è per la home. */
  variant?: "agenda" | "compact";
  /** Passandoli, la conferma si fa da qui invece che dal dettaglio. */
  onConfirm?: () => void;
  onDecline?: () => void;
  /** Solo per **questa** riga: la mutation è condivisa da tutta la lista. */
  pending?: boolean;
  /**
   * Il turno cade in una sua assenza approvata («Sei in ferie»). Il turno non
   * sparisce: lo toglie il titolare, e finché non lo fa è giusto vederlo.
   */
  absenceNote?: string | null;
}) {
  const s = STATUS[status];
  const venueName = shift.venue?.name ?? "Sede";
  const overnight = isOvernightShift(shift.start_time, shift.end_time);
  const duration = formatHours(
    shiftDurationHours(shift.start_time, shift.end_time)
  );
  const spent = status === "declined" || status === "no_show";
  const canRespond = status === "assigned" && onConfirm != null;

  if (variant === "compact") {
    return (
      <Card
        className={cn(
          "flex-row items-center gap-3 rounded-2xl border-border-2 p-3.5",
          spent && "opacity-60"
        )}
        onPress={onPress}
      >
        <View className={cn("h-8 w-1 rounded-full", s.bar)} />
        <View className="items-start">
          <Text
            className="text-[15px] font-sans-bold text-t1"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {formatTime(shift.start_time)}
          </Text>
          <Mono>{formatDayLabel(shift.date)}</Mono>
        </View>
        <View className="flex-1">
          <Text
            className="text-[15px] font-sans-semibold text-t1"
            numberOfLines={1}
          >
            {venueName}
          </Text>
          {role ? (
            <Text className="text-[13px] text-t2" numberOfLines={1}>
              {role}
            </Text>
          ) : null}
        </View>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "rounded-3xl border-border-2 p-4",
        spent && "opacity-60"
      )}
      onPress={onPress}
    >
      <View className="flex-row gap-3.5">
        <View className={cn("w-1 rounded-full", s.bar)} />

        <View className="items-start pt-0.5">
          <Text
            className="text-lg font-sans-bold text-t1"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {formatTime(shift.start_time)}
          </Text>
          <View className="flex-row items-start gap-0.5">
            <Text
              className="text-sm text-t2"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {formatTime(shift.end_time)}
            </Text>
            {/* Il turno finisce il giorno dopo: senza questo, 22:00–04:00 si
                legge come un turno che finisce diciotto ore prima di iniziare. */}
            {overnight ? <Mono gold>+1</Mono> : null}
          </View>
          <Mono className="mt-1">{duration}</Mono>
        </View>

        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Avatar uri={shift.venue?.logo_url} name={venueName} size={28} />
            <Text
              className="flex-1 text-[15px] font-sans-bold text-t1"
              numberOfLines={1}
            >
              {venueName}
            </Text>
          </View>
          <Text className="mt-1.5 text-[13px] text-t2" numberOfLines={2}>
            {role ? `${role} · ${shift.title}` : shift.title}
          </Text>
          {s.pill ? (
            <View className="mt-2 flex-row">
              <Pill label={s.pill.label} variant={s.pill.variant} />
            </View>
          ) : null}
          {absenceNote && !spent ? (
            <Text className="mt-2 text-[13px] font-sans-semibold text-warning">
              {absenceNote} · la sede deve ancora sistemare il turno
            </Text>
          ) : null}
        </View>
      </View>

      {canRespond ? (
        <View className="mt-3.5 flex-row gap-2">
          <GoldButton
            className="flex-1"
            size="sm"
            label={pending ? "Attendere…" : "Confermo"}
            disabled={pending}
            onPress={onConfirm}
          />
          <GhostButton
            className="flex-1"
            size="sm"
            label="Non posso"
            disabled={pending}
            onPress={onDecline}
          />
        </View>
      ) : null}
    </Card>
  );
}
