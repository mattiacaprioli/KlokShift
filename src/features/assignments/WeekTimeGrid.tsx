import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  ScrollView as RNScrollView,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type RefreshControlProps,
} from "react-native";
import { Pressable, Text, View } from "@/tw";
import { FontFamily } from "@/constants/fonts";
import {
  addDaysToDate,
  formatDayLabel,
  formatShiftRange,
  formatTime,
  isShiftOver,
  startOfWeek,
} from "@/lib/format";
import { useNow } from "@/lib/useNow";
import type { ShiftWithVenue } from "@/features/shifts/types";
import type { AgendaItem } from "./agenda";
import { daySegments, initialScrollHour, type GridSegment } from "./timeGrid";

/** Altezza di un'ora: 48pt fanno stare in un telefono una giornata di lavoro. */
const HOUR_H = 48;
/** Sotto questa altezza un blocco non si tocca e non si legge. */
const MIN_BLOCK_H = 22;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** La colonna delle ore: `WeekCalendar` rientra di tanto per allinearsi. */
export const HOUR_GUTTER = 32;

/**
 * Colori per stato, sugli stessi tre toni di `MyShiftCard`: verde a posto,
 * arancio c'è da rispondere, spento fuori gioco. Qui il colore è tutto il
 * blocco e non una barra, perché in una colonna da 40pt la barra non si vede.
 */
const TONE: Record<AgendaItem["status"], { bg: string; edge: string }> = {
  confirmed: { bg: "rgba(79, 201, 125, 0.20)", edge: "#4FC97D" },
  assigned: { bg: "rgba(226, 146, 47, 0.24)", edge: "#E2922F" },
  declined: { bg: "rgba(106, 99, 88, 0.25)", edge: "#6A6358" },
  no_show: { bg: "rgba(106, 99, 88, 0.25)", edge: "#6A6358" },
};

function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysToDate(monday, i));
}

function ShiftBlock({
  segment,
  columnWidth,
  absent,
  now,
  onPress,
}: {
  segment: GridSegment<AgendaItem>;
  columnWidth: number;
  absent: boolean;
  now: Date;
  onPress: () => void;
}) {
  const { item, startMin, endMin, lane, lanes, continued } = segment;
  const tone = TONE[item.status];
  const top = (startMin / 60) * HOUR_H;
  const height = Math.max(((endMin - startMin) / 60) * HOUR_H, MIN_BLOCK_H);
  const laneWidth = columnWidth / lanes;
  const venue = item.shift.venue?.name ?? "Sede";
  const over = isShiftOver(item.shift, now);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${venue}, ${formatDayLabel(item.shift.date)}, ${formatShiftRange(item.shift.start_time, item.shift.end_time)}`}
      className="absolute overflow-hidden rounded-md px-1 py-0.5"
      style={{
        top: top + 1,
        height: height - 2,
        left: lane * laneWidth + 1,
        width: laneWidth - 2,
        backgroundColor: tone.bg,
        borderLeftWidth: 2,
        borderLeftColor: tone.edge,
        // Un turno che cade nelle proprie ferie si vede subito anche qui: il
        // turno resta (lo toglie la sede), ma non deve sembrare un turno qualunque.
        ...(absent
          ? { borderWidth: 1, borderStyle: "dashed", borderColor: "#E2922F" }
          : null),
        opacity: over || item.status === "no_show" ? 0.5 : 1,
      }}
    >
      {/* La coda di un notturno inizia a mezzanotte solo per il taglio della
          colonna: ripetere l'ora d'inizio lì direbbe un'ora sbagliata. */}
      {!continued ? (
        <Text
          className="text-[10px] font-sans-bold text-t1"
          style={{ fontVariant: ["tabular-nums"] }}
          numberOfLines={1}
        >
          {formatTime(item.shift.start_time)}
        </Text>
      ) : null}
      {height >= 40 ? (
        <Text
          className="text-[10px] font-sans-semibold text-t1"
          numberOfLines={Math.max(1, Math.floor((height - 18) / 13))}
        >
          {venue}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * La settimana a griglia oraria, come la vista «Settimana» di Google Calendar:
 * sette colonne, le ore in verticale, ogni turno un blocco alto quanto dura.
 *
 * Lo scorrimento verticale è uno solo, con dentro la colonna delle ore e un
 * pager orizzontale a tre settimane ricentrato a fine gesto — lo stesso schema
 * di `WeekCalendar`. Così la griglia si sfoglia col dito, e le tre settimane
 * scorrono in verticale insieme invece di tenere ognuna la sua altezza.
 *
 * Il giorno della settimana sta nel calendario sopra (`WeekCalendar` con
 * `gutter={HOUR_GUTTER}`), che fa da intestazione: ripeterlo qui avrebbe dato
 * due righe di date una sopra l'altra.
 */
export function WeekTimeGrid({
  selected,
  onSelect,
  items,
  ready,
  today,
  onOpen,
  absenceNoteFor,
  refreshControl,
  paddingBottom,
}: {
  /** Il giorno attivo: la griglia mostra la sua settimana. */
  selected: string;
  /** Come `WeekCalendar.onSelect`: uno swipe è uno sfoglio (`browsing`). */
  onSelect: (date: string, browsing?: boolean) => void;
  /** Le assegnazioni delle tre settimane, più la domenica prima. */
  items: AgendaItem[];
  /** I dati ci sono: solo allora si sceglie l'ora su cui aprire. */
  ready: boolean;
  today: string;
  onOpen: (item: AgendaItem) => void;
  absenceNoteFor: (shift: ShiftWithVenue) => string | null;
  refreshControl?: ReactElement<RefreshControlProps>;
  paddingBottom: number;
}) {
  const now = useNow();
  const verticalRef = useRef<RNScrollView>(null);
  const pagerRef = useRef<RNScrollView>(null);
  // Vedi `WeekCalendar`: iOS consegna più fine-scorrimento per un solo gesto.
  const swipeHandled = useRef(true);
  const [width, setWidth] = useState(0);
  const pageWidth = Math.max(0, width - HOUR_GUTTER);
  const columnWidth = pageWidth / 7;

  const monday = startOfWeek(selected);
  const pages = useMemo(
    () => [-7, 0, 7].map((n) => weekDays(addDaysToDate(monday, n))),
    [monday]
  );
  const byDay = useMemo(() => daySegments(items, pages.flat()), [items, pages]);

  useEffect(() => {
    if (pageWidth > 0) {
      pagerRef.current?.scrollTo({ x: pageWidth, animated: false });
    }
  }, [pageWidth, pages]);

  // Si apre sul primo turno della settimana, una volta per settimana: dopo,
  // l'altezza la decide chi guarda, e un refetch non deve fargliela cambiare.
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || scrolledFor.current === monday) return;
    scrolledFor.current = monday;
    const hour = initialScrollHour(byDay, pages[1], new Date());
    verticalRef.current?.scrollTo({ y: hour * HOUR_H, animated: false });
  }, [ready, monday, byDay, pages]);

  function onMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (pageWidth === 0 || swipeHandled.current) return;
    swipeHandled.current = true;
    const page = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
    if (page === 1) return;
    onSelect(addDaysToDate(selected, (page - 1) * 7), true);
  }

  const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_H;

  return (
    <View
      className="flex-1 px-5"
      onLayout={(e: LayoutChangeEvent) =>
        // La griglia sta dentro lo stesso margine del calendario sopra.
        setWidth(e.nativeEvent.layout.width - 40)
      }
    >
      <RNScrollView
        ref={verticalRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 8, paddingBottom }}
        refreshControl={refreshControl}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row" style={{ height: 24 * HOUR_H }}>
          <View style={{ width: HOUR_GUTTER }}>
            {HOURS.slice(1).map((h) => (
              <Text
                key={h}
                className="absolute text-[10px] text-t3"
                style={{
                  top: h * HOUR_H - 7,
                  left: 0,
                  fontFamily: FontFamily.mono,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {String(h).padStart(2, "0")}
              </Text>
            ))}
          </View>

          {pageWidth > 0 ? (
            <RNScrollView
              ref={pagerRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onTouchStart={() => {
                swipeHandled.current = false;
              }}
              onMomentumScrollEnd={onMomentumEnd}
            >
              {pages.map((days) => (
                <View key={days[0]} className="flex-row" style={{ width: pageWidth }}>
                  {HOURS.slice(1).map((h) => (
                    <View
                      key={h}
                      className="absolute left-0 right-0 border-t border-border"
                      style={{ top: h * HOUR_H }}
                    />
                  ))}
                  {days.map((date) => (
                    <View
                      key={date}
                      className="border-l border-border"
                      style={{
                        width: columnWidth,
                        // rgba e non `bg-gold/5`: l'opacità di NativeWind passa da
                        // color-mix, che qui non arriva (vedi `Pill`).
                        backgroundColor:
                          date === today ? "rgba(234, 181, 76, 0.06)" : undefined,
                      }}
                    >
                      {(byDay.get(date) ?? []).map((seg) => (
                        <ShiftBlock
                          key={`${seg.item.id}-${seg.date}`}
                          segment={seg}
                          columnWidth={columnWidth}
                          absent={
                            seg.item.status !== "no_show" &&
                            absenceNoteFor(seg.item.shift) != null
                          }
                          now={now}
                          onPress={() => onOpen(seg.item)}
                        />
                      ))}
                      {date === today ? (
                        <View
                          pointerEvents="none"
                          className="absolute left-0 right-0 flex-row items-center"
                          style={{ top: nowTop - 4 }}
                        >
                          <View className="h-2 w-2 rounded-full bg-gold" style={{ marginLeft: -4 }} />
                          <View className="h-0.5 flex-1 bg-gold" />
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
              ))}
            </RNScrollView>
          ) : null}
        </View>
      </RNScrollView>
    </View>
  );
}
