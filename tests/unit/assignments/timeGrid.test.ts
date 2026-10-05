import { describe, expect, it } from "vitest";

import {
  daySegments,
  initialScrollHour,
  plannedHours,
} from "@/features/assignments/timeGrid";

const shift = (id: string, date: string, start: string, end: string) => ({
  id,
  shift: { date, start_time: `${start}:00`, end_time: `${end}:00` },
});

// Lunedì 5 – domenica 11 ottobre 2026.
const WEEK = [
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
  "2026-10-08",
  "2026-10-09",
  "2026-10-10",
  "2026-10-11",
];

describe("daySegments", () => {
  it("colloca un turno ordinario nel suo giorno, in minuti", () => {
    const byDay = daySegments([shift("a", "2026-10-06", "09:00", "17:00")], WEEK);
    expect(byDay.get("2026-10-06")).toMatchObject([
      { date: "2026-10-06", startMin: 540, endMin: 1020, continues: false, continued: false },
    ]);
    expect(byDay.get("2026-10-07")).toEqual([]);
  });

  it("spezza un notturno fra il giorno in cui inizia e quello dopo", () => {
    const byDay = daySegments([shift("a", "2026-10-09", "22:00", "04:00")], WEEK);
    expect(byDay.get("2026-10-09")).toMatchObject([
      { startMin: 1320, endMin: 1440, continues: true, continued: false },
    ]);
    expect(byDay.get("2026-10-10")).toMatchObject([
      { startMin: 0, endMin: 240, continues: false, continued: true },
    ]);
  });

  it("porta nel lunedì la coda del notturno della domenica prima", () => {
    const byDay = daySegments([shift("a", "2026-10-04", "23:00", "03:00")], WEEK);
    expect(byDay.get("2026-10-05")).toMatchObject([
      { startMin: 0, endMin: 180, continued: true },
    ]);
  });

  it("non disegna una coda per un turno che finisce a mezzanotte", () => {
    const byDay = daySegments([shift("a", "2026-10-06", "16:00", "00:00")], WEEK);
    expect(byDay.get("2026-10-06")).toMatchObject([
      { startMin: 960, endMin: 1440, continues: false },
    ]);
    expect(byDay.get("2026-10-07")).toEqual([]);
  });

  it("affianca in due corsie i turni che si sovrappongono", () => {
    const byDay = daySegments(
      [
        shift("pranzo", "2026-10-06", "11:00", "15:00"),
        shift("altra-sede", "2026-10-06", "14:00", "18:00"),
        shift("sera", "2026-10-06", "19:00", "23:00"),
      ],
      WEEK
    );
    const lanes = Object.fromEntries(
      byDay.get("2026-10-06")!.map((s) => [s.item.id, [s.lane, s.lanes]])
    );
    expect(lanes).toEqual({
      pranzo: [0, 2],
      "altra-sede": [1, 2],
      sera: [0, 1],
    });
  });

  it("riusa una corsia appena liberata", () => {
    const byDay = daySegments(
      [
        shift("a", "2026-10-06", "09:00", "18:00"),
        shift("b", "2026-10-06", "10:00", "12:00"),
        shift("c", "2026-10-06", "12:00", "14:00"),
      ],
      WEEK
    );
    const lanes = Object.fromEntries(
      byDay.get("2026-10-06")!.map((s) => [s.item.id, [s.lane, s.lanes]])
    );
    expect(lanes).toEqual({ a: [0, 2], b: [1, 2], c: [1, 2] });
  });
});

describe("initialScrollHour", () => {
  // Ora locale senza offset: la CI gira in UTC.
  const now = new Date("2026-10-06T15:30:00");

  it("apre un'ora prima del primo turno della settimana", () => {
    const byDay = daySegments(
      [
        shift("a", "2026-10-08", "18:00", "23:00"),
        shift("b", "2026-10-06", "09:00", "17:00"),
      ],
      WEEK
    );
    expect(initialScrollHour(byDay, WEEK, now)).toBe(8);
  });

  it("ignora le code dei notturni", () => {
    const byDay = daySegments(
      [
        shift("a", "2026-10-04", "23:00", "03:00"),
        shift("b", "2026-10-07", "18:00", "23:00"),
      ],
      WEEK
    );
    expect(initialScrollHour(byDay, WEEK, now)).toBe(17);
  });

  it("senza turni apre sull'ora corrente nella settimana in corso", () => {
    expect(initialScrollHour(daySegments([], WEEK), WEEK, now)).toBe(14);
  });

  it("senza turni, in un'altra settimana, apre sulle 8", () => {
    const next = WEEK.map((_, i) => `2026-10-${12 + i}`);
    expect(initialScrollHour(daySegments([], next), next, now)).toBe(7);
  });
});

describe("plannedHours", () => {
  it("somma le ore dei turni che iniziano nella settimana, notturni compresi", () => {
    expect(
      plannedHours(
        [
          shift("a", "2026-10-04", "23:00", "03:00"),
          shift("b", "2026-10-06", "09:00", "17:00"),
          shift("c", "2026-10-11", "22:00", "02:00"),
        ],
        WEEK
      )
    ).toBe(12);
  });
});
