import { describe, expect, it } from "vitest";
import { documentQuotaNotice, formatBytes, parseDocumentQuota } from "@/features/documents/quota";

const GIB = 1024 ** 3;
describe("spazio documenti dell'azienda", () => {
  it("nessun avviso sotto l'80%", () => {
    expect(documentQuotaNotice({ used_bytes: 1.5 * GIB, limit_bytes: 2 * GIB })).toBeNull();
    expect(documentQuotaNotice(null)).toBeNull();
  });
  it("avvisi all'80% e al 90%, blocco a quota piena", () => {
    expect(documentQuotaNotice({ used_bytes: 1.7 * GIB, limit_bytes: 2 * GIB })).toEqual({
      level: "warning", text: "Spazio documenti dell'azienda: 1,7 GB di 2 GB." });
    expect(documentQuotaNotice({ used_bytes: 1.9 * GIB, limit_bytes: 2 * GIB })?.level).toBe("critical");
    const full = documentQuotaNotice({ used_bytes: 2 * GIB + 5, limit_bytes: 2 * GIB });
    expect(full?.level).toBe("full");
    expect(full?.text).toContain("restano consultabili");
    expect(full?.text).not.toMatch(/€/);
  });
  it("misure leggibili e risposta del server controllata", () => {
    expect(formatBytes(300 * 1024 ** 2)).toBe("300 MB");
    expect(formatBytes(4 * GIB)).toBe("4 GB");
    expect(parseDocumentQuota({ used_bytes: 10, limit_bytes: 20 })).toEqual({ used_bytes: 10, limit_bytes: 20 });
    expect(parseDocumentQuota({ used_bytes: 10, limit_bytes: 0 })).toBeNull();
    expect(parseDocumentQuota(null)).toBeNull();
  });
});
