import type { ReactNode } from "react";
import { Text, View } from "@/tw";
import { Card } from "@/components/ui/Card";
import { Mono } from "@/components/ui/Mono";
import { Pill } from "@/components/ui/Pill";
import { cn } from "@/lib/cn";
import {
  shiftCounts,
  shiftCoverage,
  shiftTone,
  type ShiftTone,
} from "@/features/assignments/coverage";
import {
  formatDayLabel,
  formatHours,
  formatTime,
  isOvernightShift,
  shiftDurationHours,
  shiftSlotLabel,
} from "@/lib/format";
import type { ShiftWithCount } from "./types";

/**
 * Il titolo autogenerato dai vecchi form mobile: la data, cioè esattamente
 * quello che l'intestazione del giorno dice già. Quando lo si riconosce si
 * ripiega sulla fascia oraria, che almeno distingue due turni dello stesso
 * giorno. Un titolo scritto a mano dalla dashboard web passa invece intatto.
 */
const AUTO_TITLE = /^Turno · /;

/** Gli stessi tre colori della legenda del planning web. */
const TONE_BAR: Record<ShiftTone, string> = {
  covered: "bg-success",
  short: "bg-warning",
  off: "bg-t4",
};

function shiftLabel(shift: ShiftWithCount): string {
  const title = shift.title?.trim();
  if (title && !AUTO_TITLE.test(title)) return title;
  return shiftSlotLabel(shift.start_time);
}

/**
 * Un turno visto dalla sede: quando, che fascia, quanta gente manca.
 *
 * Prima la card dedicava la riga più forte al titolo (che era la data) e la
 * metà inferiore a una barra dorata piena, cioè a confermare che andava tutto
 * bene; il turno **scoperto** — l'unico su cui c'è qualcosa da fare — si
 * distingueva per una barra più corta alta un pixel. Ora è il contrario: chi è
 * a posto sta zitto, chi è scoperto porta barra arancio e «manca N».
 *
 * Il dettaglio per ruolo sta qui — e non in una seconda schermata, come fino al
 * 13/09/2026 — ma solo quando «x/y» da solo non basta a sapere cosa fare: con
 * due ruoli in ballo, o con uno scoperto, serve leggere *quale*.
 */
export function ManagerShiftCard({
  shift,
  onPress,
  variant = "agenda",
  venue,
  footer,
}: {
  shift: ShiftWithCount;
  onPress: () => void;
  /** `compact` porta con sé il giorno: è per la home, che non ha un'agenda. */
  variant?: "agenda" | "compact";
  /**
   * In quale sede. **Assente con una sede sola**: l'agenda del titolare mostra
   * tutte le sedi insieme, ma chi ne ha una non deve leggerne il nome su ogni
   * card. Il nome è il segnale, `accent` (vedi `venueColor.ts`) è l'appiglio.
   */
  venue?: { name: string; accent: string };
  /** Sotto la copertura, solo nella variante agenda: lo storico ci mette il consuntivo. */
  footer?: ReactNode;
}) {
  const cancelled = shift.status === "cancelled";
  const closed = shift.status === "closed";
  const { filled, total, short } = shiftCounts(shift);
  // Un turno annullato non è scoperto: non deve coprirlo più nessuno.
  const alert = short && !cancelled;
  const tone = shiftTone(shift);
  const label = shiftLabel(shift);
  const overnight = isOvernightShift(shift.start_time, shift.end_time);

  // Le relazioni della copertura viaggiano già con il turno: nessuna query in
  // più per sapere che il buco è sul barista e non sul cameriere.
  const coverage = shiftCoverage(shift);
  const showRoles =
    !cancelled &&
    coverage.rows.length > 0 &&
    (coverage.rows.length > 1 || coverage.missing > 0);

  /**
   * La barra a sinistra dice **la copertura**, e dice la stessa cosa del bordo
   * colorato del planning web: verde coperto, arancio manca qualcuno, spento se
   * non c'è più niente da coprire (`shiftTone`).
   *
   * Fino al 14/09/2026 erano due regole diverse: qui il verde non c'era (chi era
   * a posto prendeva l'oro del marchio) e con più sedi la barra passava alla
   * *sede*, che è un'altra domanda. La sede ha il suo posto — il nome in
   * `accent` sopra il titolo, che si legge anche senza distinguere i colori.
   */
  const bar = TONE_BAR[tone];

  if (variant === "compact") {
    return (
      <Card
        className={cn(
          "flex-row items-center gap-3 rounded-2xl border-border-2 p-3.5",
          cancelled && "opacity-60"
        )}
        onPress={onPress}
      >
        <View className={cn("h-8 w-1 rounded-full", bar)} />
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
            {label}
          </Text>
          <Text
            className={cn(
              "text-[13px]",
              alert ? "font-sans-semibold text-warning" : "text-t2"
            )}
          >
            {/* La sede prima della copertura: nella home i turni di tre sedi
                si susseguono, e senza il nome due card identiche sono
                indistinguibili. Nel suo colore, da quando la barra a sinistra
                è tornata a dire la copertura. */}
            {venue ? (
              <Text style={{ color: venue.accent }}>{venue.name} · </Text>
            ) : null}
            {alert ? `manca ${total - filled}` : `${filled}/${total} coperti`}
          </Text>
        </View>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "rounded-3xl border-border-2 p-4",
        cancelled && "opacity-60"
      )}
      onPress={onPress}
    >
      <View className="flex-row gap-3.5">
        <View className={cn("w-1 rounded-full", bar)} />

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
            {/* Il turno finisce il giorno dopo: senza questo, 17:00–01:00 si
                legge come un turno che finisce sedici ore prima di iniziare. */}
            {overnight ? <Mono gold>+1</Mono> : null}
          </View>
          <Mono className="mt-1">
            {formatHours(shiftDurationHours(shift.start_time, shift.end_time))}
          </Mono>
        </View>

        <View className="flex-1">
          {/* Il nome della sede sopra il titolo, in mono come le altre
              etichette di contesto: è quello che si cerca per primo scorrendo
              un'agenda che mescola tre sedi. */}
          {venue ? (
            <Text
              className="mb-0.5 font-mono text-[9.5px] uppercase"
              style={{ letterSpacing: 1.3, color: venue.accent }}
              numberOfLines={1}
            >
              {venue.name}
            </Text>
          ) : null}
          <View className="flex-row items-start justify-between gap-2">
            <Text
              className="flex-1 text-[15px] font-sans-bold text-t1"
              numberOfLines={1}
            >
              {label}
            </Text>
            {/* Nessuna etichetta per «Aperto»: è lo stato normale, e dirlo su
                ogni card in verde toglieva risalto a quelle che un problema ce
                l'hanno davvero. */}
            {alert ? (
              <Pill
                label={`manca ${total - filled}`}
                variant="pending"
                icon="alert"
              />
            ) : cancelled ? (
              <Pill label="Annullato" variant="cancelled" />
            ) : closed ? (
              <Pill label="Chiuso" variant="closed" />
            ) : null}
          </View>
          {showRoles ? (
            // I ruoli **al posto** del rapporto, non sotto: «2/3 coperti» e
            // «Cameriere 2/2 · Barista 0/1» sono la stessa frase detta due
            // volte. Verde su nessuno — solo chi manca si fa notare.
            <View className="mt-2 flex-row flex-wrap gap-1.5">
              {coverage.rows.map((r) => (
                <Pill
                  key={r.role}
                  label={`${r.role} ${r.covered}/${r.required}`}
                  variant={r.covered >= r.required ? "neutral" : "pending"}
                />
              ))}
            </View>
          ) : (
            /* Il rapporto resta neutro anche quando manca qualcuno: l'allarme
               lo danno già la barra e la pill, e ripeterlo in arancio faceva
               gridare due volte la stessa cosa. */
            <Text className="mt-1.5 text-[13px] text-t2">
              {total > 0 ? `${filled}/${total} coperti` : "Nessun fabbisogno"}
            </Text>
          )}
          {footer}
        </View>
      </View>
    </Card>
  );
}
