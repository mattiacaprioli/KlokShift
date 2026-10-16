import { Text, View } from "@/tw";
import {
  SHIFT_RANGE_ERROR,
  formatShiftSummary,
  isValidShiftRange,
  toDateString,
  toTimeString,
} from "@/lib/format";
import { BreakField } from "./BreakField";
import { shiftBreakError } from "./breaks";
import { TimeField } from "./TimeField";

type Props = {
  /** Giorno di **inizio** del turno: serve a dire in che giorno cade la fine. */
  date: Date;
  start: Date;
  end: Date;
  onStartChange: (d: Date) => void;
  onEndChange: (d: Date) => void;
  /**
   * La pausa pianificata e la scelta della sede: con lei il riepilogo dice
   * anche le ore che il turno conta.
   */
  pause?: {
    minutes: number;
    paid: boolean;
    onChange: (minutes: number) => void;
  };
};

/**
 * I due campi orario del turno con, sotto, il riepilogo della durata.
 *
 * Stanno insieme perché un turno notturno (22:00–04:00) letto come due orari
 * slegati sembra finire diciotto ore prima di iniziare: è il riepilogo a dire
 * che la fine cade il giorno dopo, ed è lì che si intercetta un orario digitato
 * per sbaglio. Condiviso dai tre form dell'app che scelgono un orario. Con la
 * pausa il riepilogo dice anche le ore che il turno conta.
 */
export function ShiftTimeFields({
  date,
  start,
  end,
  onStartChange,
  onEndChange,
  pause,
}: Props) {
  const valid = isValidShiftRange(toTimeString(start), toTimeString(end));
  const pauseError =
    valid && pause
      ? shiftBreakError(toTimeString(start), toTimeString(end), pause.minutes)
      : null;

  return (
    <View className="gap-2.5">
      <View className="flex-row gap-4">
        <TimeField
          className="flex-1"
          label="Dalle"
          value={start}
          onChange={onStartChange}
        />
        <TimeField
          className="flex-1"
          label="Alle"
          value={end}
          onChange={onEndChange}
        />
      </View>
      {pause ? (
        <BreakField minutes={pause.minutes} onChange={pause.onChange} />
      ) : null}
      {pauseError ? (
        <Text className="text-xs font-sans-semibold text-error">
          {pauseError}
        </Text>
      ) : valid ? (
        <Text className="text-xs text-t3">
          {formatShiftSummary(
            toDateString(date),
            toTimeString(start),
            toTimeString(end),
            pause ? { break_minutes: pause.minutes, break_paid: pause.paid } : undefined
          )}
        </Text>
      ) : (
        // Con inizio uguale a fine la durata varrebbe 24 ore tonde: è un orario
        // ancora da correggere, non una durata da annunciare.
        <Text className="text-xs font-sans-semibold text-error">
          {SHIFT_RANGE_ERROR}
        </Text>
      )}
    </View>
  );
}
