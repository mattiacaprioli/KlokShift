import { RealtimeClient } from "@supabase/realtime-js";
import { describe, expect, it, vi } from "vitest";

import { watchRejoin } from "@/features/realtime/rejoin";

describe("watchRejoin (B10)", () => {
  it("non recupera al primo ingresso, recupera a ogni rientro", () => {
    const recover = vi.fn();
    const { onStatus } = watchRejoin(recover);

    onStatus("SUBSCRIBED");
    expect(recover).not.toHaveBeenCalled();

    onStatus("CHANNEL_ERROR");
    onStatus("TIMED_OUT");
    onStatus("CLOSED");
    expect(recover).not.toHaveBeenCalled();

    onStatus("SUBSCRIBED");
    onStatus("CLOSED");
    onStatus("SUBSCRIBED");
    expect(recover).toHaveBeenCalledTimes(2);
  });

  it("dopo lo stop (unmount, logout, cambio azienda) un rientro tardivo non fa nulla", () => {
    const recover = vi.fn();
    const watcher = watchRejoin(recover);
    watcher.onStatus("SUBSCRIBED");
    watcher.stop();
    watcher.onStatus("SUBSCRIBED");
    expect(recover).not.toHaveBeenCalled();
  });
});

/**
 * Websocket finto per il client vero di Supabase (protocollo 1.0.0, JSON): apre
 * subito e risponde «ok» a ogni join, con gli id dei binding postgres_changes.
 */
class FakeSocket {
  static sockets: FakeSocket[] = [];
  readyState = 0;
  binaryType = "arraybuffer";
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(public url: string) {
    FakeSocket.sockets.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }

  send(data: string) {
    const msg = JSON.parse(data);
    if (msg.event === "phx_join") {
      const bindings = msg.payload.config?.postgres_changes ?? [];
      setTimeout(() =>
        this.onmessage?.({
          data: JSON.stringify({
            topic: msg.topic,
            event: "phx_reply",
            ref: msg.ref,
            join_ref: msg.join_ref,
            payload: {
              status: "ok",
              response: {
                postgres_changes: bindings.map((b: object, id: number) => ({ ...b, id })),
              },
            },
          }),
        })
      );
    } else if (msg.event === "heartbeat") {
      setTimeout(() =>
        this.onmessage?.({
          data: JSON.stringify({
            topic: "phoenix", event: "phx_reply", ref: msg.ref, payload: { status: "ok", response: {} },
          }),
        })
      );
    }
  }

  /** La rete cade: il server non ha chiuso, il client deve riconnettersi da solo. */
  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: "rete persa" });
  }

  close() {
    this.readyState = 3;
  }
}

describe("client realtime di Supabase: il rientro ripete SUBSCRIBED (B10)", () => {
  it("dopo una caduta del websocket la callback di subscribe riceve di nuovo SUBSCRIBED", async () => {
    FakeSocket.sockets = [];
    const client = new RealtimeClient("ws://localhost/realtime/v1", {
      params: { apikey: "test" },
      transport: FakeSocket as never,
      vsn: "1.0.0",
      reconnectAfterMs: () => 5,
      heartbeatIntervalMs: 60_000,
    });
    const recover = vi.fn();
    const watcher = watchRejoin(recover);
    const statuses: string[] = [];
    const channel = client
      .channel("sync:test")
      .on("postgres_changes", { event: "*", schema: "public", table: "shifts" }, () => undefined)
      .subscribe((status) => {
        statuses.push(status);
        watcher.onStatus(status);
      });

    await vi.waitFor(() => expect(statuses).toEqual(["SUBSCRIBED"]));
    expect(recover).not.toHaveBeenCalled();

    FakeSocket.sockets[0].drop();

    await vi.waitFor(() => expect(statuses.filter((s) => s === "SUBSCRIBED")).toHaveLength(2), {
      timeout: 3000,
    });
    expect(FakeSocket.sockets.length).toBeGreaterThan(1);
    expect(recover).toHaveBeenCalledTimes(1);

    watcher.stop();
    await client.removeChannel(channel);
    client.disconnect();
  });
});
