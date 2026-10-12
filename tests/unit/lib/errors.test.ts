import { describe, expect, it } from "vitest";
import { GENERIC_ERROR, userErrorMessage } from "../../../src/lib/errors";

describe("userErrorMessage", () => {
  it("traduce il blocco dei turni nati da una timbratura (C06)", () => {
    const message = userErrorMessage(new Error("unplanned_shift_locked"));
    expect(message).not.toBe(GENERIC_ERROR);
    expect(message).toMatch(/annulla la timbratura/);
  });
});
