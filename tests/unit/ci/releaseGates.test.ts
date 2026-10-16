import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CI_SUPABASE_ANON_KEY,
  CI_SUPABASE_URL,
  checkBundle,
  selectSupabaseConfig,
} from "../../../scripts/release-config.mjs";

function repoFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("release workflows", () => {
  const ci = repoFile(".github/workflows/ci.yml");
  const pages = repoFile(".github/workflows/deploy-web.yml");
  const database = repoFile(".github/workflows/supabase.yml");
  const deno = repoFile("supabase/functions/deno.json");

  it("rende tutti i gate prerequisiti di entrambi i deploy", () => {
    const job = (name: string) => {
      const start = ci.indexOf(`  ${name}:`);
      const end = ci.indexOf("\n  deploy-", start + 1);
      return ci.slice(start, end === -1 ? undefined : end);
    };
    expect(job("deploy-database")).toContain("needs: [client, database, edge]");
    // La dashboard esce dopo le migration: mai una versione che legge colonne
    // che il database non ha ancora (16/10, la pausa).
    expect(job("deploy-pages")).toContain(
      "needs: [changes, client, database, edge, deploy-database]"
    );
    expect(ci.slice(ci.indexOf("  deploy-pages:"))).not.toMatch(/always\(\)|cancelled\(\)/);
  });

  it("applica le migration a ogni rilascio, senza filtro sui file del push", () => {
    // Una migration in un push il cui run è fallito o è stato scavalcato in
    // coda non usciva mai (C08). `db push` senza niente da applicare è innocuo.
    const deploy = ci.slice(ci.indexOf("  deploy-database:"));
    expect(deploy).not.toContain("needs.changes.outputs");
    expect(ci).not.toContain("outputs.database");
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

describe("segreti e ordine dei rilasci (C11)", () => {
  const ci = repoFile(".github/workflows/ci.yml");
  const database = repoFile(".github/workflows/supabase.yml");

  const step = (workflow: string, name: string) => {
    const start = workflow.indexOf(`- name: ${name}`);
    const end = workflow.indexOf("\n      - ", start);
    return workflow.slice(start, end === -1 ? undefined : end);
  };

  it("passa i segreti Supabase solo agli step che li usano", () => {
    for (const name of ["Link project", "Push migrations"]) {
      expect(step(database, name)).toContain(
        "SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}"
      );
      expect(step(database, name)).toContain(
        "SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}"
      );
    }
    // Due step per due segreti: nessun'altra occorrenza, nemmeno sul job.
    expect(database.match(/secrets\.SUPABASE_/g)).toHaveLength(4);
  });

  it("fissa a uno SHA l'azione esterna del rilascio del DB", () => {
    expect(database).toMatch(/uses: supabase\/setup-cli@[0-9a-f]{40} /);
  });

  it("passa al deploy del DB solo i segreti dichiarati", () => {
    const deploy = ci.slice(ci.indexOf("  deploy-database:"));
    expect(ci).not.toContain("secrets: inherit");
    expect(deploy).toContain("SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}");
    expect(deploy).toContain("SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}");
  });

  it("mette in coda i run sullo stesso ref senza interromperli", () => {
    const head = ci.slice(0, ci.indexOf("\njobs:"));
    expect(head).toMatch(
      /^concurrency:\n {2}group: ci-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: false$/m
    );
  });

  it("non ignora expo-env.d.ts, che il typecheck della CI richiede", () => {
    const res = spawnSync("git", ["check-ignore", "--no-index", "-q", "expo-env.d.ts"], {
      cwd: process.cwd(),
    });
    // 0 = ignorato, 1 = non ignorato, 128 = errore di git.
    expect(res.status).toBe(1);
  });
});

describe("configurazione Supabase del bundle pubblicato (B01)", () => {
  const ci = repoFile(".github/workflows/ci.yml");
  const client = ci.slice(ci.indexOf("\n  client:"), ci.indexOf("\n  database:"));

  const jwt = (payload: object) =>
    [
      Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
      Buffer.from(JSON.stringify(payload)).toString("base64url"),
      "firma",
    ].join(".");
  const url = "https://abcdefghijklmnopqrst.supabase.co";
  const anon = jwt({ iss: "supabase", ref: "abcdefghijklmnopqrst", role: "anon" });

  it("usa valori sintetici fuori dal rilascio", () => {
    expect(selectSupabaseConfig({ release: false, url, key: anon })).toEqual({
      url: CI_SUPABASE_URL,
      key: CI_SUPABASE_ANON_KEY,
    });
  });

  it("usa la configurazione reale nel rilascio", () => {
    expect(selectSupabaseConfig({ release: true, url: `${url}/`, key: anon })).toEqual({ url, key: anon });
    const publishable = "sb_publishable_abc123";
    expect(selectSupabaseConfig({ release: true, url, key: publishable }).key).toBe(publishable);
  });

  it("fa fallire un rilascio senza URL o key", () => {
    expect(() => selectSupabaseConfig({ release: true, url: "", key: anon })).toThrow(/senza configurazione/);
    expect(() => selectSupabaseConfig({ release: true, url })).toThrow(/senza configurazione/);
  });

  it("fa fallire un rilascio con i placeholder della CI", () => {
    expect(() =>
      selectSupabaseConfig({ release: true, url: CI_SUPABASE_URL, key: anon })
    ).toThrow(/fittizi/);
    expect(() =>
      selectSupabaseConfig({ release: true, url, key: CI_SUPABASE_ANON_KEY })
    ).toThrow(/fittizi/);
  });

  it("rifiuta le key segrete senza stamparle", () => {
    const serviceRole = jwt({ iss: "supabase", role: "service_role" });
    for (const key of [serviceRole, "sb_secret_abc123"]) {
      let message = "";
      try {
        selectSupabaseConfig({ release: true, url, key });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/pubblica/);
      expect(message).not.toContain(key);
    }
  });

  it("verifica il dominio nel bundle compilato", () => {
    const dir = mkdtempSync(join(tmpdir(), "klokshift-bundle-"));
    try {
      mkdirSync(join(dir, "assets"));
      const bundle = join(dir, "assets", "index.js");
      writeFileSync(bundle, `createClient("${url}","${anon}")`);
      expect(() => checkBundle({ dir, expectedHost: "abcdefghijklmnopqrst.supabase.co" })).not.toThrow();
      expect(() => checkBundle({ dir, expectedHost: "altro.supabase.co" })).toThrow(/host Supabase atteso/);

      writeFileSync(bundle, `createClient("${CI_SUPABASE_URL}","${CI_SUPABASE_ANON_KEY}")`);
      expect(() => checkBundle({ dir, expectedHost: "abcdefghijklmnopqrst.supabase.co" })).toThrow(/fittizi/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("compila il rilascio con la configurazione scelta e verificata", () => {
    expect(client).not.toContain(`EXPO_PUBLIC_SUPABASE_URL: ${CI_SUPABASE_URL}`);
    expect(client).toContain("vars.EXPO_PUBLIC_SUPABASE_URL");
    expect(client).toContain("vars.EXPO_PUBLIC_SUPABASE_ANON_KEY");
    const select = client.indexOf("release-config.mjs select");
    const build = client.indexOf("run: yarn web:build");
    const check = client.indexOf("release-config.mjs check-bundle web/dist");
    expect(select).toBeGreaterThan(-1);
    expect(select).toBeLessThan(build);
    expect(check).toBeGreaterThan(build);
  });

  it("carica l'artifact Pages solo nel rilascio", () => {
    const upload = client.slice(client.indexOf("Assembla artifact Pages"));
    expect(upload.match(/if: env\.KS_RELEASE == 'true'/g)).toHaveLength(2);
  });
});
