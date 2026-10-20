import { describe, expect, it, vi } from "vitest";

import { parseReminder, reminderMail, runReminders, type Reminder } from "../../../supabase/functions/archive-reminders/logic";
import { edgeRuntime, post } from "./runtime";

const r = (over: Partial<Reminder> = {}): Reminder => ({
  id: "r1", kind: "started", archiveUntil: "2027-10-19T19:28:48+00:00", workspaceName: "Bar <Stagione>",
  email: "titolare@example.test", attempts: 0, ...over,
});

describe("archive-reminders: contenuto", () => {
  it("le tre fasi, con la data italiana e il link alla pagina Piano", () => {
    expect(reminderMail(r(), "https://k.test/app/").subject).toBe("Bar <Stagione>: l'archivio resta consultabile fino al 19/10/2027");
    expect(reminderMail(r({ kind: "30_days" }), "https://k.test/app").subject).toBe("Bar <Stagione>: l'archivio scade il 19/10/2027");
    expect(reminderMail(r({ kind: "7_days" }), "https://k.test/app").subject).toBe("Bar <Stagione>: fra 7 giorni i dati vengono cancellati");
    const mail = reminderMail(r(), "https://k.test/app/");
    expect(mail.text).toContain("https://k.test/app/#/piano");
    expect(mail.text).toContain("Gli account delle persone restano.");
    expect(mail.html).toContain('<a href="https://k.test/app/#/piano">');
    expect(mail.html).toContain("Bar &lt;Stagione&gt;");
    expect(mail.html).not.toContain("<Stagione>");
  });

  it("niente prezzi nel testo", () => {
    expect(reminderMail(r({ kind: "7_days" }), "https://k.test/app").text).not.toMatch(/€|\d+,\d\d/);
  });

  it("una riga strana non si spedisce", () => {
    expect(parseReminder({ id: "r1", kind: "started", archive_until: "2027-10-19T19:28:48Z",
      workspace_name: "W", email: "a@b.c", email_attempts: 0 })).not.toBeNull();
    expect(parseReminder({ id: "r1", kind: "1_day", archive_until: "2027-10-19T19:28:48Z",
      workspace_name: "W", email: "a@b.c", email_attempts: 0 })).toBeNull();
    expect(parseReminder({ id: "r1", kind: "started", archive_until: "ieri",
      workspace_name: "W", email: "a@b.c", email_attempts: 0 })).toBeNull();
  });
});

describe("archive-reminders: invio", () => {
  it("segna inviate solo le email partite, conta un tentativo per quelle fallite", async () => {
    const deps = {
      listPending: vi.fn(async () => [r({ id: "ok" }), r({ id: "ko", email: "rifiuta@example.test" })]),
      send: vi.fn(async (to: string) => to !== "rifiuta@example.test"),
      markSent: vi.fn(async () => true),
      markFailed: vi.fn(async () => true),
    };
    expect(await runReminders(deps, "https://k.test/app")).toEqual({ sent: 1, failed: 1 });
    expect(deps.markSent).toHaveBeenCalledWith("ok");
    expect(deps.markFailed).toHaveBeenCalledWith(expect.objectContaining({ id: "ko" }));
  });

  it("senza il segreto delle push non fa nulla", async () => {
    const from = vi.fn();
    const edge = edgeRuntime("archive-reminders", {
      "npm:@supabase/supabase-js@2.117.0": { createClient: () => ({ from }) },
      "https://deno.land/x/denomailer@1.6.0/mod.ts": { SMTPClient: vi.fn() },
    });
    expect((await edge.handle(post({}, { "x-push-secret": "sbagliato" }))).status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });
});
