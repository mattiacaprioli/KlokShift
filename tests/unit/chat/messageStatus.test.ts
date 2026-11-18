import { describe, expect, it } from "vitest";
import {
  MESSAGE_STATUS_LABEL,
  messageStatus,
  otherDeliveredAt,
} from "@/features/chat/messageStatus";

describe("messageStatus", () => {
  const msg = { created_at: "2026-11-18T10:00:00Z", read_at: null };

  it("inviato senza segnalibro", () => {
    expect(messageStatus(msg, null)).toBe("sent");
  });

  it("inviato se il segnalibro è prima", () => {
    expect(messageStatus(msg, "2026-11-18T09:59:59Z")).toBe("sent");
  });

  it("ricevuto allo stesso istante", () => {
    expect(messageStatus(msg, "2026-11-18T10:00:00Z")).toBe("delivered");
  });

  it("ricevuto anche con formati diversi dello stesso istante", () => {
    expect(
      messageStatus(
        { created_at: "2026-11-18T10:00:00.000Z", read_at: null },
        "2026-11-18T10:00:00+00:00"
      )
    ).toBe("delivered");
  });

  it("visualizzato vince anche senza segnalibro", () => {
    expect(
      messageStatus({ ...msg, read_at: "2026-11-18T10:05:00Z" }, null)
    ).toBe("read");
  });
});

describe("otherDeliveredAt", () => {
  const c = { user_a: "a", user_a_delivered_at: "A", user_b_delivered_at: "B" };

  it("usa il lato dell'altro (io sono a)", () => {
    expect(otherDeliveredAt(c, "a")).toBe("B");
  });

  it("usa il lato dell'altro (io sono b)", () => {
    expect(otherDeliveredAt(c, "b")).toBe("A");
  });
});

describe("MESSAGE_STATUS_LABEL", () => {
  it("dice lo stato a parole", () => {
    expect(MESSAGE_STATUS_LABEL).toEqual({
      sending: "In invio",
      sent: "Inviato",
      delivered: "Ricevuto",
      read: "Visualizzato",
    });
  });
});
