import { describe, expect, it, vi } from "vitest";
import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import type {
  ConversationDetail,
  Message,
} from "@/features/chat/api";
import { qk } from "@/lib/queryKeys";

import {
  applyConversationUpdateToCache,
  applyMessageUpdateToCache,
} from "@/features/chat/hooks";

vi.mock("@/features/chat/api", () => ({}));

function msg(id: string, read_at: string | null = null): Message {
  return {
    id,
    conversation_id: "c1",
    sender_id: "me",
    content: id,
    read_at,
    created_at: "2026-11-18T10:00:00Z",
    kind: "text",
    request_id: null,
    absence_id: null,
  } as Message;
}

describe("applyMessageUpdateToCache", () => {
  it("aggiorna read_at del messaggio giusto, anche in una pagina successiva", () => {
    const qc = new QueryClient();
    const key = qk.chat.messages("c1");
    qc.setQueryData<InfiniteData<Message[]>>(key, {
      pages: [[msg("a")], [msg("b"), msg("c")]],
      pageParams: [null, null],
    });
    applyMessageUpdateToCache(qc, msg("b", "2026-11-18T10:05:00Z"));
    const data = qc.getQueryData<InfiniteData<Message[]>>(key)!;
    expect(data.pages[1][0].read_at).toBe("2026-11-18T10:05:00Z");
    expect(data.pages[0][0].read_at).toBeNull();
    expect(data.pages[1][1].read_at).toBeNull();
  });

  it("senza cache non fa nulla", () => {
    const qc = new QueryClient();
    applyMessageUpdateToCache(qc, msg("a", "x"));
    expect(qc.getQueryData(qk.chat.messages("c1"))).toBeUndefined();
  });
});

describe("applyConversationUpdateToCache", () => {
  it("aggiorna il segnalibro e conserva la controparte", () => {
    const qc = new QueryClient();
    const key = qk.chat.conversation("c1");
    const other = { name: "Emma", subtitle: null, avatarUrl: null };
    qc.setQueryData<ConversationDetail>(key, {
      id: "c1",
      user_a: "a",
      user_b: "b",
      user_a_delivered_at: null,
      user_b_delivered_at: null,
      other,
    } as unknown as ConversationDetail);
    applyConversationUpdateToCache(qc, {
      id: "c1",
      user_a: "a",
      user_b: "b",
      user_a_delivered_at: null,
      user_b_delivered_at: "2026-11-18T10:00:00Z",
    } as unknown as ConversationDetail);
    const data = qc.getQueryData<ConversationDetail>(key)!;
    expect(data.user_b_delivered_at).toBe("2026-11-18T10:00:00Z");
    expect(data.other).toEqual(other);
  });

  it("senza cache non fa nulla", () => {
    const qc = new QueryClient();
    applyConversationUpdateToCache(qc, { id: "c1" } as unknown as ConversationDetail);
    expect(qc.getQueryData(qk.chat.conversation("c1"))).toBeUndefined();
  });
});
