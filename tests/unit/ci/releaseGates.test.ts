import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function repoFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("release workflows", () => {
  const ci = repoFile(".github/workflows/ci.yml");
  const pages = repoFile(".github/workflows/deploy-web.yml");
  const database = repoFile(".github/workflows/supabase.yml");
  const deno = repoFile("supabase/functions/deno.json");

  it("rende tutti i gate prerequisiti di entrambi i deploy", () => {
    expect(
      ci.match(/needs: \[changes, client, database, edge\]/g)
    ).toHaveLength(2);
    expect(ci.slice(ci.indexOf("  deploy-pages:"))).not.toMatch(/always\(\)/);
  });

  it("non permette di avviare i deploy fuori dal workflow verificato", () => {
    for (const workflow of [pages, database]) {
      expect(workflow).toContain("workflow_call:");
      expect(workflow).not.toMatch(/^\s+push:/m);
      expect(workflow).not.toMatch(/^\s+workflow_dispatch:/m);
    }
  });

  it("include lockfile e configurazioni nei filtri di pubblicazione", () => {
    expect(ci).toContain("yarn.lock");
    expect(ci).toContain(".github/workflows/deploy-web.yml");
    expect(ci).toContain(".github/workflows/supabase.yml");
  });

  it("fissa le versioni degli strumenti di rilascio", () => {
    expect(ci).toContain("deno-version: 2.9.6");
    expect(database).toContain("version: 2.108.0");
    expect(database).not.toContain("version: latest");
    expect(JSON.parse(deno).lock.frozen).toBe(true);
  });
});
