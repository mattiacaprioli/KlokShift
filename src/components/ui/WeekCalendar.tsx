import { useEffect, useMemo, useRef, useState } from "react";
import type { LayoutChangeEvent, NativeSyntheticEvent , NativeScrollEvent } from "react-native";
import { ScrollView as RNScrollView } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Pressable, Text, View } from "@/tw";
import { cn } from "@/lib/cn";
import { Icon } from "./Icon";
import { Mono } from "./Mono";
import {
  addDaysToDate,
  formatMonthLabel,
  startOfWeek,
  todayString,
  toDateString,
} from "@/lib/format";

/** Iniziali dei giorni, da lunedì: l'intestazione fissa sopra la griglia. */
const WEEKDAYS = ["L", "M", "M", "G", "V", "S", "D"];

const CELL = 42;
const ROW_GAP = 6;
const ROW_H = CELL + ROW_GAP;
/** Sei righe coprono qualunque mese, anche febbraio che inizia di domenica. */
const MONTH_ROWS = 6;

/** Il lunedì da cui parte la griglia del mese che contiene `date`. */
function monthGridStart(date: string): string {
  return startOfWeek(`${date.slice(0, 7)}-01`);
}

/** Il primo del mese che contiene `date` — l'ancora della vista mensile. */
function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function addMonths(date: string, months: number): string {
  const d = new Date(`${monthStart(date)}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return toDateString(d);
}

function daysFrom(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDaysToDate(start, i));
}

function DayCell({
  date,
  selected,
  today,
  marked,
  muted,
  alert,
  onPress,
}: {
  date: string;
  selected: boolean;
  today: boolean;
  marked: boolean;
  /** Giorno di un altro mese, mostrato solo per riempire la griglia. */
  muted: boolean;
  /** Quel giorno ha qualcosa che non va: il pallino passa all'arancio. */
  alert: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 items-center"
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      {/* Il giorno scelto che ha un problema si tinge di arancio tutto: un
          pallino arancio su fondo oro non si distingue, e il segnale andava
          perso proprio sul giorno che si sta guardando. */}
      <View
        className={cn(
          "items-center justify-center rounded-2xl border",
          selected
            ? marked && alert
              ? "border-warning bg-warning"
              : "border-gold bg-gold"
            : today
              ? "border-gold bg-transparent"
              : "border-transparent bg-transparent"
        )}
        style={{ width: CELL, height: CELL, borderCurve: "continuous" }}
      >
        <Text
          className={cn(
            "text-[15px]",
            selected
              ? "font-sans-bold text-gold-ink"
              : muted
                ? "font-sans text-t4"
                : "font-sans-semibold text-t1"
          )}
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {Number(date.slice(8, 10))}
        </Text>
        {/* Sul giorno selezionato il pallino va in negativo: su fondo pieno,
            oro su oro (o arancio su arancio) non si vedrebbe. L'allarme lì lo
            porta già lo sfondo della cella. */}
        <View
          className={cn(
            "mt-0.5 h-1 w-1 rounded-full",
            !marked
              ? "bg-transparent"
              : selected
                ? "bg-gold-ink"
                : alert
                  ? "bg-warning"
                  : "bg-gold"
          )}
        />
      </View>
    </Pressable>
  );
}

/**
 * Calendario dell'agenda: una settimana sempre visibile, il mese a richiesta.
 *
 * Le due viste condividono celle e impaginazione — una griglia di sette colonne
 * che scorre di una settimana o di un mese alla volta — perché sono la stessa
 * cosa vista da due distanze, e tenerle separate significava due componenti che
 * divergono al primo ritocco.
 *
 * Lo scorrimento è una `ScrollView` a tre pagine ricentrata a fine gesto: è il
 * modo di avere pagine infinite senza aggiungere una libreria di calendario,
 * nessuna delle quali si veste con la palette AURA.
 */
export function WeekCalendar({
  selected,
  onSelect,
  marked,
  alerts,
  expanded,
  onToggleExpand,
  right,
  className,
}: {
  /** Il giorno attivo, "YYYY-MM-DD". */
  selected: string;
  /**
   * `browsing` distingue lo sfoglio dal tocco: sfogliare i mesi sposta il
   * giorno attivo ma non è una scelta, e non deve chiudere la griglia sotto le
   * dita di chi la sta guardando.
   */
  onSelect: (date: string, browsing?: boolean) => void;
  /** I giorni con almeno un turno: ricevono il pallino. */
  marked: Set<string>;
  /**
   * I giorni con qualcosa da sistemare — per la sede, quelli con un turno
   * scoperto. Il pallino diventa arancio, e il calendario smette di dire solo
   * *dove ci sono turni* per dire *dove c'è un problema*.
   */
  alerts?: Set<string>;
  expanded: boolean;
  onToggleExpand: () => void;
  /**
   * Slot a destra della riga del mese, per un dato che parla del periodo
   * mostrato (per la sede: quanti turni ci sono e quanti sono scoperti).
   * Sta qui e non sotto il calendario perché sotto verrebbe letto come
   * l'intestazione di ciò che segue.
   */
  right?: React.ReactNode;
  className?: string;
}) {
  const scrollRef = useRef<RNScrollView>(null);
  // iOS può consegnare più `onMomentumScrollEnd` mentre, dopo uno swipe, le
  // tre pagine vengono ricostruite e ricentrate. Un tocco fisico apre un solo
  // ciclo: la prima fine-scorrimento lo consuma, le successive appartengono
  // ancora allo stesso gesto (o al ricentraggio interno) e vanno ignorate.
  const swipeHandled = useRef(true);
  const [width, setWidth] = useState(0);
  const today = todayString();

  // La pagina centrale è sempre quella del giorno attivo: non c'è un'ancora da
  // tenere in sincrono, perché scorrere di una settimana *è* spostarsi di una
  // settimana. Sfogliare senza scegliere lascerebbe calendario e agenda a
  // guardare due momenti diversi, che è il modo più rapido per perdersi.
  const anchor = expanded ? monthStart(selected) : startOfWeek(selected);

  const pages = useMemo(() => {
    const step = (n: number) =>
      expanded ? addMonths(anchor, n) : addDaysToDate(anchor, n * 7);
    return [step(-1), anchor, step(1)].map((a) => ({
      anchor: a,
      days: expanded
        ? daysFrom(monthGridStart(a), MONTH_ROWS * 7)
        : daysFrom(a, 7),
    }));
  }, [anchor, expanded]);

  // Ogni cambio di pagine rimette il viewport al centro: le tre pagine sono
  // sempre le stesse tre, è il loro contenuto a scorrere.
  useEffect(() => {
    if (width > 0) scrollRef.current?.scrollTo({ x: width, animated: false });
  }, [width, pages]);

  const height = useSharedValue(expanded ? ROW_H * MONTH_ROWS : ROW_H);
  useEffect(() => {
    height.value = withTiming(expanded ? ROW_H * MONTH_ROWS : ROW_H, {
      duration: 220,
    });
  }, [expanded, height]);
  const gridStyle = useAnimatedStyle(() => ({ height: height.value }));

  function onMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (width === 0 || swipeHandled.current) return;
    swipeHandled.current = true;
    const page = Math.round(e.nativeEvent.contentOffset.x / width);
    if (page === 1) return;
    const delta = page - 1;
    // A settimana si tiene lo stesso giorno della settimana (giovedì resta
    // giovedì); a mese si atterra sul primo, che è l'unico giorno che esiste
    // di certo anche nel mese accanto.
    onSelect(
      expanded ? addMonths(selected, delta) : addDaysToDate(selected, delta * 7),
      true
    );
  }

  return (
    <View className={className} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <Pressable
        onPress={onToggleExpand}
        className="mb-2 flex-row items-center gap-1.5 py-1"
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <Mono gold>{formatMonthLabel(pages[1].anchor)}</Mono>
        <Icon
          name="chevR"
          size={14}
          color="#EAB54C"
          // Non c'è una chevron verso il basso nel set: è la stessa, ruotata.
          style={{ transform: [{ rotate: expanded ? "-90deg" : "90deg" }] }}
        />
        {right ? <View className="flex-1 items-end">{right}</View> : null}
      </Pressable>

      <View className="mb-1 flex-row">
        {WEEKDAYS.map((d, i) => (
          <View key={`${d}-${i}`} className="flex-1 items-center">
            <Mono>{d}</Mono>
          </View>
        ))}
      </View>

      <Animated.View style={[gridStyle, { overflow: "hidden" }]}>
        {width > 0 ? (
          <RNScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onTouchStart={() => {
              swipeHandled.current = false;
            }}
            onMomentumScrollEnd={onMomentumEnd}
          >
            {pages.map((page) => (
              <View key={page.anchor} style={{ width }}>
                {Array.from(
                  { length: page.days.length / 7 },
                  (_, row) => (
                    <View
                      key={row}
                      className="flex-row"
                      style={{ height: ROW_H }}
                    >
                      {page.days.slice(row * 7, row * 7 + 7).map((date) => (
                        <DayCell
                          key={date}
                          date={date}
                          selected={date === selected}
                          today={date === today}
                          marked={marked.has(date)}
                          alert={alerts?.has(date) ?? false}
                          muted={
                            expanded &&
                            date.slice(0, 7) !== page.anchor.slice(0, 7)
                          }
                          onPress={() => onSelect(date)}
                        />
                      ))}
                    </View>
                  )
                )}
              </View>
            ))}
          </RNScrollView>
        ) : null}
      </Animated.View>
    </View>
  );
}
