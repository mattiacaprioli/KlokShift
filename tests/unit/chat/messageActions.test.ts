import { describe, expect, it } from "vitest";
import {
  DELETED_TEXT,
  changesPreview,
  canDelete,
  canEdit,
  previewText,
} from "@/features/chat/messageActions";

const sent = new Date("2026-11-18T10:00:00Z");
const after = (ms: number) => new Date(sent.getTime() + ms);
const MIN = 60_000;
const HOUR = 60 * MIN;

const mine = {
  sender_id: "me",
  kind: "text" as const,
  deleted_at: null,
  created_at: sent.toISOString(),
};

describe("canEdit", () => {
  it("entro i 15 minuti sì", () => {
    expect(canEdit(mine, "me", after(14 * MIN + 59_000))).toBe(true);
  });
  it("oltre i 15 minuti no", () => {
    expect(canEdit(mine, "me", after(15 * MIN + 1_000))).toBe(false);
  });
  it("il messaggio altrui no", () => {
    expect(canEdit(mine, "other", after(MIN))).toBe(false);
  });
  it("una card no", () => {
    expect(
      canEdit({ ...mine, kind: "shift_change_request" }, "me", after(MIN))
    ).toBe(false);
  });
  it("un eliminato no", () => {
    expect(
      canEdit({ ...mine, deleted_at: after(MIN).toISOString() }, "me", after(2 * MIN))
    ).toBe(false);
  });
});

describe("canDelete", () => {
  it("entro le 48 ore sì", () => {
    expect(canDelete(mine, "me", after(47 * HOUR + 59 * MIN))).toBe(true);
  });
  it("oltre le 48 ore no", () => {
    expect(canDelete(mine, "me", after(48 * HOUR + 1_000))).toBe(false);
  });
  it("il messaggio altrui no", () => {
    expect(canDelete(mine, "other", after(MIN))).toBe(false);
  });
  it("una card no", () => {
    expect(
      canDelete({ ...mine, kind: "shift_change_request" }, "me", after(MIN))
    ).toBe(false);
  });
  it("un eliminato no", () => {
    expect(
      canDelete({ ...mine, deleted_at: after(MIN).toISOString() }, "me", after(2 * MIN))
    ).toBe(false);
  });
});

describe("previewText", () => {
  it("un eliminato dice che è stato eliminato", () => {
    expect(previewText({ content: "", deleted_at: "2026-11-18T10:01:00Z" })).toBe(
      "Messaggio eliminato"
    );
    expect(DELETED_TEXT).toBe("Messaggio eliminato");
  });
  it("altrimenti il testo", () => {
    expect(previewText({ content: "ciao", deleted_at: null })).toBe("ciao");
  });
});

describe("changesPreview", () => {
  it("una modifica o un'eliminazione cambia l'anteprima della lista", () => {
    expect(changesPreview({ edited_at: "x", deleted_at: null })).toBe(true);
    expect(changesPreview({ edited_at: null, deleted_at: "x" })).toBe(true);
  });
  it("una semplice lettura no", () => {
    expect(changesPreview({ edited_at: null, deleted_at: null })).toBe(false);
  });
});
