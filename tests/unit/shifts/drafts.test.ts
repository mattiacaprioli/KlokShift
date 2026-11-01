import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  confirmAllQuestion,
  confirmedToast,
  draftsBannerText,
  isDraft,
  isExpiredDraft,
  draftsCountLabel,
  nobodyToNotifyText,
  notifyLabel,
  otherDrafts,
  outsideNote,
  publishTitle,
  otherDraftsText,
  publishCta,
  publishedToast,
  summarizeDrafts,
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

describe("pubblica nell'intestazione", () => {
  it("il pulsante dice quanti turni escono", () => {
    expect(publishCta(1)).toBe("Pubblica 1 turno");
    expect(publishCta(7)).toBe("Pubblica 7 turni");
  });

  it("le bozze fuori dal periodo, in una riga sola", () => {
    expect(otherDraftsText({ upcoming: 0, expired: 0 })).toBeNull();
    expect(otherDraftsText({ upcoming: 1, expired: 0 })).toBe(
      "1 bozza in un altro periodo"
    );
    expect(otherDraftsText({ upcoming: 3, expired: 0 })).toBe(
      "3 bozze in altri periodi"
    );
    expect(otherDraftsText({ upcoming: 0, expired: 1 })).toBe(
      "1 mai pubblicato"
    );
    expect(otherDraftsText({ upcoming: 2, expired: 2 })).toBe(
      "2 bozze in altri periodi · 2 mai pubblicati"
    );
  });
});

describe("bozze fuori dal periodo", () => {
  const now = new Date(2026, 10, 4, 12, 0); // 4 novembre, ora locale
  const d = (date: string, venue_id = "v1") => ({
    date,
    start_time: "09:00",
    end_time: "17:00",
    venue_id,
  });

  it("conta quelle di altri periodi e quelle finite, e porta alla prima da pubblicare", () => {
    expect(
      otherDrafts(
        [d("2026-11-03"), d("2026-11-05"), d("2026-11-20"), d("2026-11-12")],
        { from: "2026-11-02", to: "2026-11-08", venueIds: ["v1"], now }
      )
    ).toEqual({ text: "2 bozze in altri periodi", target: "2026-11-12" });
  });

  it("ignora le sedi che non si pubblicano e ripiega sulla prima finita", () => {
    expect(
      otherDrafts([d("2026-10-20"), d("2026-11-20", "v2")], {
        from: "2026-11-02",
        to: "2026-11-08",
        venueIds: ["v1"],
        now,
      })
    ).toEqual({ text: "1 mai pubblicato", target: "2026-10-20" });
  });

  it("niente da dire, niente riga", () => {
    expect(
      otherDrafts([d("2026-11-05")], {
        from: "2026-11-02",
        to: "2026-11-08",
        venueIds: ["v1"],
        now,
      })
    ).toEqual({ text: null, target: null });
  });
});

describe("finestra di pubblicazione", () => {
  it("titolo sul periodo", () => {
    expect(publishTitle("week")).toBe("Pubblica la settimana");
    expect(publishTitle("month")).toBe("Pubblica il mese");
  });

  it("quanti turni e chi avvisare", () => {
    expect(draftsCountLabel(1)).toBe("turno in bozza");
    expect(draftsCountLabel(5)).toBe("turni in bozza");
    expect(notifyLabel(1)).toBe("Avvisa 1 persona");
    expect(notifyLabel(3)).toBe("Avvisa 3 persone");
  });

  it("le bozze fuori dal periodo restano in bozza", () => {
    expect(outsideNote(0)).toBeNull();
    expect(outsideNote(1)).toBe(
      "C'è un'altra bozza fuori da questo periodo: resta in bozza."
    );
    expect(outsideNote(4)).toBe(
      "Altre 4 bozze fuori da questo periodo restano in bozza."
    );
  });
});

describe("nessuno da avvisare, con il motivo", () => {
  it("turni senza persone", () => {
    expect(nobodyToNotifyText({ assignees: 0, self: false })).toBe(
      "Nessuno da avvisare: questi turni non hanno ancora persone."
    );
  });
  it("nel turno ci sei solo tu", () => {
    expect(nobodyToNotifyText({ assignees: 1, self: true })).toBe(
      "Nessuno da avvisare: nei turni ci sei solo tu, e chi pubblica non riceve la notifica."
    );
  });
  it("tu e persone senza app", () => {
    expect(nobodyToNotifyText({ assignees: 3, self: true })).toBe(
      "Nessuno da avvisare: a parte te, chi è nei turni non ha ancora l'app collegata."
    );
  });
  it("solo persone senza app", () => {
    expect(nobodyToNotifyText({ assignees: 2, self: false })).toBe(
      "Nessuno da avvisare: chi è nei turni non ha ancora l'app collegata."
    );
  });
  it("server vecchio senza i dettagli: frase neutra", () => {
    expect(nobodyToNotifyText({})).toBe("Nessuno da avvisare.");
  });
});
