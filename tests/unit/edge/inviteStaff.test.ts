import { describe, expect, it, vi } from "vitest";
import { edgeRuntime, post } from "./runtime";
import { TEAM_ACCESS_LABELS, teamAccessLines } from "../../../supabase/functions/invite-staff/logic";
import { TEAM_PERMISSION_LABEL } from "@/features/workspace/permissions";

function fixture(
  channel: "email" | "token" = "email",
  venues = ["Sede\r\nBcc: estraneo@example.test"],
  adminExtra: Record<string, unknown> = {}
) {
  const payload = {
    channel, email: "persona@example.test", display_name: "Ada\tRossi",
    workspace_name: '\r\nAzienda\x01 <R&D "Soci">\r\nX-Header: falso\x7f',
    venue_names: venues,
  };
  const rpc = vi.fn().mockResolvedValue({ data: [payload], error: null });
  const send = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const admin = { rpc, ...adminExtra };
  const asUser = { auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) } };
  class SMTPClient {
    send = send;
    close = close;
  }
  const edge = edgeRuntime("invite-staff", {
    "npm:@supabase/supabase-js@2.117.0": { createClient: (_url: string, key: string) => key === "fixture-anon" ? asUser : admin },
    "https://deno.land/x/denomailer@1.6.0/mod.ts": { SMTPClient },
  });
  const request = () => edge.handle(post({ memberId: "member" }, { Authorization: "Bearer fixture" }));
  return { ...edge, payload, rpc, send, close, request };
}

describe("invite-staff: email e risposte", () => {
  it.each(["email", "token"] as const)("%s neutralizza i controlli nei nomi e mantiene l'escape HTML", async (channel) => {
    const f = fixture(channel);
    const response = await f.request();
    expect(response.status).toBe(200);
    const mail = f.send.mock.calls[0][0];
    expect(mail.subject).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(mail.content).toContain('Azienda  <R&D "Soci"> X-Header: falso');
    expect(mail.content).not.toContain(f.payload.workspace_name);
    expect(mail.html).toContain('Azienda  &lt;R&amp;D &quot;Soci&quot;&gt; X-Header: falso');
    expect(mail.html).not.toContain('<R&D "Soci">');
    if (channel === "email") {
      expect(mail.content).toContain("Sede Bcc: estraneo@example.test");
      expect(mail.content).not.toContain(f.payload.venue_names[0]);
    }
    expect(f.close).toHaveBeenCalledOnce();
  });

  it("senza sedi l'oggetto usa il nome aziendale normalizzato", async () => {
    const f = fixture("email", []);
    await f.request();
    expect(f.send.mock.calls[0][0].subject).not.toMatch(/[\u0000-\u001f\u007f]/);
  });

  it("un errore SMTP resta generico anche se close fallisce", async () => {
    const f = fixture("token");
    f.send.mockImplementation(async (mail) => {
      throw new Error(`provider leaked ${mail.html} fixture-smtp-secret`);
    });
    f.close.mockRejectedValue(new Error("close failed"));
    const response = await f.request();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "smtp_failed" });
    const logged = JSON.stringify(f.log.mock.calls);
    const token = f.send.mock.calls[0][0].html.match(/invito\?t=([a-f0-9]+)/)?.[1];
    expect(token).toBeTruthy();
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(f.rpc.mock.calls[0][1].p_token_hash);
    expect(logged).not.toContain("fixture-smtp-secret");
  });

  it("close fallito non trasforma un invio riuscito in un errore", async () => {
    const f = fixture();
    f.close.mockRejectedValue(new Error("close failed"));
    const response = await f.request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: true });
  });

  it("all'invito del collaboratore dice permessi e sedi", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        can_shifts: true, can_staff: false, can_hours: true, can_documents: false, can_venue: false,
        scope: "selected",
        member_scope: [
          { venues: { name: "Roma", closed_at: null } },
          { venues: { name: "Milano", closed_at: null } },
          { venues: { name: "Chiusa", closed_at: "2026-01-01" } },
        ],
      },
      error: null,
    });
    const chain: Record<string, unknown> = { maybeSingle };
    chain.select = () => chain;
    chain.eq = () => chain;
    const f = fixture("token", ["Roma"], { from: () => chain });
    await f.request();
    const mail = f.send.mock.calls[0][0];
    expect(mail.content).toContain("Puoi gestire: Turni e Ore ed export.");
    expect(mail.content).toContain("Sedi: Milano e Roma.");
    expect(mail.html).toContain("Puoi gestire: Turni e Ore ed export.");
  });

  it("se i permessi non si leggono l'invito parte con la frase generica", async () => {
    const f = fixture("token");
    const response = await f.request();
    expect(response.status).toBe(200);
    expect(f.send.mock.calls[0][0].content).toContain("Avrai i permessi che ha scelto per te.");
  });
});

describe("invite-staff: testo dei permessi", () => {
  it("usa gli stessi nomi dei permessi dell'app", () => {
    expect(Object.values(TEAM_ACCESS_LABELS)).toEqual([
      TEAM_PERMISSION_LABEL.can_manage_shifts,
      TEAM_PERMISSION_LABEL.can_manage_staff,
      TEAM_PERMISSION_LABEL.can_view_hours,
      TEAM_PERMISSION_LABEL.can_manage_documents,
      TEAM_PERMISSION_LABEL.can_manage_venue,
    ]);
  });

  it("senza permessi né sedi dice cosa aspettarsi", () => {
    const none = { can_shifts: false, can_staff: false, can_hours: false, can_documents: false, can_venue: false };
    expect(teamAccessLines({ ...none, scope: "selected", venues: [] })).toEqual({
      can: "Per ora puoi solo consultare: i permessi te li dà il titolare.",
      where: "Sedi: nessuna sede per ora: te le assegna il titolare.",
    });
    expect(teamAccessLines({ ...none, can_venue: true, scope: "all", venues: [] }).where).toBe(
      "Sedi: tutte le sedi, anche quelle che apriranno."
    );
  });
});
