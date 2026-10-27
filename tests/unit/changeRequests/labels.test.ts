import { describe, expect, it } from "vitest";
import { myPendingRequestText } from "@/features/changeRequests/labels";

describe("myPendingRequestText", () => {
  it("la sostituzione si chiama sostituzione", () => {
    expect(
      myPendingRequestText({
        kind: "substitution",
        proposed_start_time: null,
        proposed_end_time: null,
      })
    ).toBe("Hai chiesto una sostituzione: aspetta la risposta della sede.");
  });

  it("l'orario diverso dice l'orario chiesto", () => {
    expect(
      myPendingRequestText({
        kind: "hours",
        proposed_start_time: "19:00:00",
        proposed_end_time: "22:00:00",
      })
    ).toBe(
      "Hai chiesto di lavorare dalle 19:00 alle 22:00: aspetta la risposta della sede."
    );
  });

  it("senza orario resta una richiesta di orario, non una sostituzione", () => {
    expect(
      myPendingRequestText({
        kind: "hours",
        proposed_start_time: null,
        proposed_end_time: null,
      })
    ).toBe("Hai chiesto un orario diverso: aspetta la risposta della sede.");
  });
});
