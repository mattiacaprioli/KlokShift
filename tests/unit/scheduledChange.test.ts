import { describe, expect, it } from "vitest";
import {
  describePlanTarget,
  pendingChangeCancellable,
  scheduledChangeBlocker,
} from "@/features/workspace/scheduledChange";

const team = { plan: "team", interval: "month", extraVenues: 2 } as const;
const input = (target: { plan: "base" | "team"; interval: "month" | "year"; extraVenues: number },
  people = 12, openVenues = 1) => ({ current: team, target, people, openVenues });

describe("cambio dal prossimo rinnovo: cosa lo blocca", () => {
  it("la stessa scelta di oggi", () => {
    expect(scheduledChangeBlocker(input(team))).toBe("È la stessa scelta che hai già.");
  });

  it("un aumento di piano o di sedi passa dal modulo dell'aumento", () => {
    const msg = "Per aumentare piano o sedi usa il modulo dell'aumento: vale subito.";
    expect(scheduledChangeBlocker(input({ ...team, extraVenues: 3 }))).toBe(msg);
    expect(scheduledChangeBlocker(input({ ...team, interval: "year", extraVenues: 3 }))).toBe(msg);
    expect(scheduledChangeBlocker({
      current: { plan: "base", interval: "month", extraVenues: 0 },
      target: { plan: "team", interval: "year", extraVenues: 0 }, people: 3, openVenues: 1,
    })).toBe(msg);
  });

  it("Base con più di 30 persone nel team", () => {
    expect(scheduledChangeBlocker(input({ ...team, plan: "base" }, 34)))
      .toBe("Hai 34 persone nel team: il piano Base ne comprende 30.");
    expect(scheduledChangeBlocker(input({ ...team, plan: "base" }, 30))).toBeNull();
  });

  it("meno sedi di quelle aperte", () => {
    expect(scheduledChangeBlocker(input({ ...team, extraVenues: 1 }, 12, 3)))
      .toBe("Hai 3 sedi aperte: chiudine 1 prima di ridurre.");
    expect(scheduledChangeBlocker(input({ ...team, extraVenues: 0 }, 12, 3)))
      .toBe("Hai 3 sedi aperte: chiudine 2 prima di ridurre.");
  });

  it("le persone vengono prima delle sedi", () => {
    expect(scheduledChangeBlocker(input({ plan: "base", interval: "month", extraVenues: 0 }, 34, 3)))
      .toBe("Hai 34 persone nel team: il piano Base ne comprende 30.");
  });

  it("una riduzione che sta nei limiti, o il solo cambio di ciclo", () => {
    expect(scheduledChangeBlocker(input({ plan: "base", interval: "year", extraVenues: 0 }, 30, 1))).toBeNull();
    expect(scheduledChangeBlocker(input({ ...team, interval: "year" }, 80, 3))).toBeNull();
  });
});

describe("descrizione del punto d'arrivo", () => {
  it("una sede, al singolare", () => {
    expect(describePlanTarget({ plan: "base", interval: "year", extraVenues: 0 })).toBe("Base · annuale, 1 sede");
  });
  it("più sedi, al plurale", () => {
    expect(describePlanTarget({ plan: "team", interval: "month", extraVenues: 2 })).toBe("Team · mensile, 3 sedi");
  });
});

describe("annullare il cambio in attesa", () => {
  const change = { status: "pending", cancel_until: "2026-11-17T10:00:00.000Z" } as const;
  it("in attesa e prima del termine", () => {
    expect(pendingChangeCancellable(change, new Date("2026-11-17T09:59:59.000Z"))).toBe(true);
  });
  it("dal termine in poi no, come sul server", () => {
    expect(pendingChangeCancellable(change, new Date("2026-11-17T10:00:00.000Z"))).toBe(false);
  });
  it("già inviato a Paddle no", () => {
    expect(pendingChangeCancellable({ ...change, status: "applied" }, new Date("2026-11-01T00:00:00Z"))).toBe(false);
  });
});
