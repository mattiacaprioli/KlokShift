import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { createContext, Script } from "node:vm";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { vi } from "vitest";

type Handler = (request: Request) => Promise<Response>;
type TestModule = { exports: Record<string, unknown> };
type ModuleRunner = (
  require: (specifier: string) => unknown,
  module: TestModule,
  exports: TestModule["exports"]
) => void;

/** Handler originale, runtime Deno e provider simulati: nessuna rete o invio. */
export function edgeRuntime(
  name: "accept-invite" | "invite-staff" | "push" | "paddle-webhook" | "billing-checkout" | "billing-manage" | "workspace-file-cleanup",
  imports: Record<string, unknown>,
  envOverrides: Record<string, string | undefined> = {},
  globals: Record<string, unknown> = {}
) {
  let handler: Handler | undefined;
  const log = vi.fn();
  const env: Record<string, string> = {
    SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service-secret",
    SMTP_HOST: "smtp.example.test", SMTP_PORT: "465", SMTP_USER: "fixture",
    SMTP_PASS: "fixture-smtp-secret", SMTP_FROM: "KlokShift <fixture@example.test>",
    SITE_URL: "https://klokshift.example.test", DASHBOARD_URL: "https://klokshift.example.test/app",
    PUSH_HOOK_SECRET: "fixture-push-secret",
    PADDLE_WEBHOOK_SECRET: "fixture-paddle-secret", PADDLE_ENVIRONMENT: "sandbox",
    PADDLE_API_KEY: "pdl_sdbx_apikey_fixture-secret", PADDLE_CLIENT_TOKEN: "test_fixturetoken",
  };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete env[key]; else env[key] = value;
  }
  const context = createContext({
    ...globals,
    Request, Response, TextEncoder, Uint8Array, crypto: webcrypto,
    console: { error: log },
    Deno: {
      env: { get: (key: string) => env[key] },
      serve: (next: Handler) => { handler = next; },
    },
  });
  const modules = new Map<string, TestModule>();
  function load(file: string): TestModule["exports"] {
    const cached = modules.get(file);
    if (cached) return cached.exports;
    const module: TestModule = { exports: {} };
    modules.set(file, module);
    const compiled = transpileModule(readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
    });
    const runner = new Script(`(function(require, module, exports) {\n${compiled.outputText}\n})`, {
      filename: file,
    }).runInContext(context) as ModuleRunner;
    runner((specifier) => {
      if (Object.hasOwn(imports, specifier)) return imports[specifier];
      if (specifier.startsWith("./")) return load(resolve(dirname(file), specifier));
      throw new Error(`Import Edge non simulato: ${specifier}`);
    }, module, module.exports);
    return module.exports;
  }
  load(fileURLToPath(new URL(`../../../supabase/functions/${name}/index.ts`, import.meta.url)));
  if (!handler) throw new Error("Handler Edge non registrato");
  return { handle: handler, log };
}

export function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://edge.example.test", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
