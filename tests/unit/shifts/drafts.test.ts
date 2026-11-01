import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  confirmAllQuestion,
  confirmedToast,
  draftsBannerText,
  isDraft,
  isExpiredDraft,
  NOBODY_TO_NOTIFY,
  publishPreviewLines,
  shouldOfferNotifyChoice,
  publishedToast,
  summarizeDrafts,
  type PublishPreview,
} from "@/features/shifts/drafts";

describe("isDraft", () => {
  it("è bozza solo senza data di pubblicazione", () => {
    expect(isDraft({ published_at: null })).toBe(true);
    expect(isDraft({ published_at: "2026-10-01T10:00:00Z" })).toBe(false);
  });
});

describe("isExpiredDraft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00"));
  });
  afterEach(() => vi.useRealTimers());

  const times = { date: "2026-11-10", start_time: "08:00", end_time: "11:00" };

  it("una bozza finita è «mai pubblicata»", () => {
    expect(isExpiredDraft({ published_at: null, ...times })).toBe(true);
  });

  it("una bozza in corso o futura non lo è", () => {
    expect(
      isExpiredDraft({ published_at: null, ...times, end_time: "13:00" })
    ).toBe(false);
    expect(
      isExpiredDraft({ published_at: null, ...times, date: "2026-11-11" })
    ).toBe(false);
  });

  it("un turno pubblicato non lo è mai", () => {
    expect(
      isExpiredDraft({ published_at: "2026-11-01T10:00:00Z", ...times })
    ).toBe(false);
  });

  it("accetta un orologio esplicito", () => {
    expect(
      isExpiredDraft(
        { published_at: null, ...times },
        new Date("2026-11-10T09:00:00")
      )
    ).toBe(false);
  });
});

describe("draftsBannerText", () => {
  it("null quando non c'è niente", () => {
    expect(draftsBannerText({ upcoming: 0, expired: 0, months: [] })).toBeNull();
  });

  it("plurale e singolare con i mesi", () => {
    expect(
      draftsBannerText({ upcoming: 12, expired: 0, months: ["dicembre"] })
    ).toBe("12 turni in bozza (dicembre)");
    expect(
      draftsBannerText({ upcoming: 1, expired: 0, months: ["novembre"] })
    ).toBe("1 turno in bozza (novembre)");
  });

  it("più mesi e turni mai pubblicati", () => {
    expect(
      draftsBannerText({
        upcoming: 3,
        expired: 1,
        months: ["novembre", "dicembre"],
      })
    ).toBe("3 turni in bozza (novembre, dicembre) · 1 mai pubblicato");
    expect(
      draftsBannerText({ upcoming: 2, expired: 4, months: ["novembre"] })
    ).toBe("2 turni in bozza (novembre) · 4 mai pubblicati");
  });

  it("solo mai pubblicati", () => {
    expect(draftsBannerText({ upcoming: 0, expired: 2, months: [] })).toBe(
      "2 mai pubblicati"
    );
  });
});

describe("publishPreviewLines", () => {
  const base: PublishPreview = {
    shift_ids: [],
    shifts: 4,
    people: 2,
    outside: 1,
    expired: 0,
  };

  it("turni, persone e bozze fuori periodo", () => {
    expect(publishPreviewLines(base)).toEqual([
      "4 turni",
      "Avvisiamo 2 persone",
      "C'è un'altra bozza fuori da questo periodo",
    ]);
  });

  it("plurale delle bozze fuori periodo, singolari di turni e persone", () => {
    expect(
      publishPreviewLines({ ...base, shifts: 1, people: 1, outside: 3 })
    ).toEqual([
      "1 turno",
      "Avvisiamo 1 persona",
      "Ci sono altre 3 bozze fuori da questo periodo",
    ]);
  });

  it("nessuno da avvisare: lo dice e non offre la scelta degli avvisi", () => {
    expect(publishPreviewLines({ ...base, people: 0 })[1]).toBe(
      NOBODY_TO_NOTIFY
    );
    expect(shouldOfferNotifyChoice({ people: 0 })).toBe(false);
    expect(shouldOfferNotifyChoice({ people: 3 })).toBe(true);
  });

  it("senza bozze fuori la terza riga non c'è", () => {
    expect(publishPreviewLines({ ...base, outside: 0 })).toHaveLength(2);
  });
});

describe("summarizeDrafts", () => {
  const now = new Date("2026-11-10T12:00:00");
  const t = (date: string, start = "08:00", end = "11:00") => ({
    date,
    start_time: start,
    end_time: end,
  });

  it("separa le bozze da pubblicare da quelle già finite", () => {
    const r = summarizeDrafts(
      [t("2026-11-02"), t("2026-12-03"), t("2026-11-20"), t("2026-12-09")],
      now
    );
    expect(r.upcoming).toBe(3);
    expect(r.expired).toBe(1);
    expect(r.months).toEqual(["dicembre", "novembre"]);
    expect(r.firstDate).toBe("2026-11-20");
  });

  it("senza bozze non c'è niente", () => {
    expect(summarizeDrafts([], now)).toEqual({
      upcoming: 0,
      expired: 0,
      months: [],
      firstDate: null,
    });
  });
});

describe("publishedToast", () => {
  it("singolare e plurale", () => {
    expect(publishedToast(1)).toBe("Pubblicato 1 turno");
    expect(publishedToast(12)).toBe("Pubblicati 12 turni");
  });
});

describe("conferma tutti", () => {
  it("domanda e toast, singolare e plurale", () => {
    expect(confirmAllQuestion(1)).toBe("Confermi 1 turno?");
    expect(confirmAllQuestion(3)).toBe("Confermi 3 turni?");
    expect(confirmedToast(1)).toBe("Confermato 1 turno");
    expect(confirmedToast(2)).toBe("Confermati 2 turni");
  });
});
