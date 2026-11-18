import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeliveryScheduler } from "@/features/chat/delivery";

describe("createDeliveryScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("una raffica fa una chiamata", async () => {
    const mark = vi.fn().mockResolvedValue(1);
    const s = createDeliveryScheduler(mark, 1500);
    for (let i = 0; i < 10; i++) {
      s.request();
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(1500);
    expect(mark).toHaveBeenCalledTimes(1);
  });

  it("due raffiche lontane fanno due chiamate", async () => {
    const mark = vi.fn().mockResolvedValue(1);
    const s = createDeliveryScheduler(mark, 1500);
    s.request();
    await vi.advanceTimersByTimeAsync(2000);
    s.request();
    await vi.advanceTimersByTimeAsync(2000);
    expect(mark).toHaveBeenCalledTimes(2);
  });

  it("un errore di mark non rompe le richieste successive", async () => {
    const mark = vi
      .fn()
      .mockRejectedValueOnce(new Error("rete"))
      .mockResolvedValue(1);
    const s = createDeliveryScheduler(mark, 1500);
    s.request();
    await vi.advanceTimersByTimeAsync(2000);
    s.request();
    await vi.advanceTimersByTimeAsync(2000);
    expect(mark).toHaveBeenCalledTimes(2);
  });

  it("cancel annulla la chiamata in attesa", async () => {
    const mark = vi.fn().mockResolvedValue(1);
    const s = createDeliveryScheduler(mark, 1500);
    s.request();
    s.cancel();
    await vi.advanceTimersByTimeAsync(2000);
    expect(mark).not.toHaveBeenCalled();
  });
});
