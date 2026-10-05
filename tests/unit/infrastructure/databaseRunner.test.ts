import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const preferred = "ghcr.io/supabase/postgres:17.6.1.127";
const mirror = "public.ecr.aws/supabase/postgres:17.6.1.127";
const runner = resolve(process.cwd(), "supabase/tests/run.sh");

interface DockerScenario {
  containerExists?: boolean;
  cachedImages?: string[];
  pullFailures?: Record<string, number>;
  daemonUnavailable?: boolean;
  startFails?: boolean;
  readinessFailures?: number;
}

interface Call {
  command: "docker" | "sleep";
  args: string[];
}

// Si esegue il Bash effettivo, sostituendo solo gli strumenti esterni. Il
// processo stub condivide contatori su disco fra chiamate, senza Docker o rete.
const stub = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const scenario = JSON.parse(fs.readFileSync(process.env.KS_RUNNER_SCENARIO, "utf8"));
const state = JSON.parse(fs.readFileSync(process.env.KS_RUNNER_STATE, "utf8"));
fs.appendFileSync(process.env.KS_RUNNER_CALLS, JSON.stringify({ command, args }) + "\\n");
function finish(status, message = "") {
  fs.writeFileSync(process.env.KS_RUNNER_STATE, JSON.stringify(state));
  if (message) process.stderr.write(message + "\\n");
  process.exit(status);
}
if (command === "sleep") finish(0);
switch (args[0]) {
  case "info":
    finish(scenario.daemonUnavailable ? 1 : 0, scenario.daemonUnavailable ? "Cannot connect to Docker daemon" : "");
    break;
  case "inspect":
    finish(scenario.containerExists || state.created ? 0 : 1);
    break;
  case "image":
    if (args[1] !== "inspect") finish(98, "Unexpected docker image command");
    finish(state.cachedImages.includes(args.at(-1)) ? 0 : 1);
    break;
  case "pull": {
    const image = args.at(-1);
    state.pulls[image] = (state.pulls[image] || 0) + 1;
    if (state.pulls[image] <= (scenario.pullFailures?.[image] || 0)) {
      finish(1, "toomanyrequests: Rate exceeded");
    }
    state.cachedImages.push(image);
    finish(0);
    break;
  }
  case "run":
    if (!args.includes("--pull=never")) finish(97, "Container creation may not download images implicitly");
    if (!state.cachedImages.includes(args.at(-1))) finish(96, "Image is not cached");
    state.created = true;
    finish(0);
    break;
  case "start":
    finish(scenario.startFails ? 1 : 0, scenario.startFails ? "Could not start container" : "");
    break;
  case "exec":
    if (!args.includes("pg_isready")) finish(98, "Unexpected docker exec command");
    state.readinessCalls += 1;
    finish(state.readinessCalls <= (scenario.readinessFailures || 0) ? 1 : 0);
    break;
  case "logs":
    process.stdout.write("database logs from test fixture\\n");
    finish(0);
    break;
  default:
    finish(98, "Unexpected docker command: " + args.join(" "));
}
`;

function runRunner(scenario: DockerScenario = {}, command: "up" | "down" = "up") {
  const dir = mkdtempSync(join(tmpdir(), "klokshift-database-runner-"));
  const scenarioPath = join(dir, "scenario.json");
  const statePath = join(dir, "state.json");
  const callsPath = join(dir, "calls.jsonl");
  try {
    writeFileSync(scenarioPath, JSON.stringify(scenario));
    writeFileSync(statePath, JSON.stringify({
      cachedImages: scenario.cachedImages ?? [],
      pulls: {},
      readinessCalls: 0,
      created: false,
    }));
    writeFileSync(callsPath, "");
    writeFileSync(join(dir, "docker"), stub, { mode: 0o755 });
    writeFileSync(join(dir, "sleep"), stub, { mode: 0o755 });
    const result = spawnSync("bash", [runner, command], {
      cwd: resolve(process.cwd()),
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH ?? ""}`,
        KS_RUNNER_SCENARIO: scenarioPath,
        KS_RUNNER_STATE: statePath,
        KS_RUNNER_CALLS: callsPath,
      },
      encoding: "utf8",
      timeout: 15_000,
    });
    if (result.error) throw result.error;
    const lines = readFileSync(callsPath, "utf8").trim();
    const calls: Call[] = lines ? lines.split("\n").map((line) => JSON.parse(line) as Call) : [];
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type RunResult = ReturnType<typeof runRunner>;
const dockerCalls = (result: RunResult, command: string) =>
  result.calls.filter((call) => call.command === "docker" && call.args[0] === command);
const pulledImages = (result: RunResult) => dockerCalls(result, "pull").map((call) => call.args.at(-1));
const sleeps = (result: RunResult) =>
  result.calls.filter((call) => call.command === "sleep").map((call) => call.args[0]);
const readiness = (result: RunResult) =>
  dockerCalls(result, "exec").filter((call) => call.args.includes("pg_isready"));

function expectCreatedWith(result: RunResult, image: string) {
  const runs = dockerCalls(result, "run");
  expect(runs).toHaveLength(1);
  expect(runs[0].args).toContain("--pull=never");
  expect(runs[0].args.at(-1)).toBe(image);
  expect(runs[0].args).toContain("klokshift-pg");
}

describe("banco Postgres locale: avvio", () => {
  it("ritenta un errore transitorio e avvia l'immagine preferita con versione fissa", () => {
    const result = runRunner({ pullFailures: { [preferred]: 1 } });

    expect(result.status).toBe(0);
    expect(pulledImages(result)).toEqual([preferred, preferred]);
    expect(sleeps(result)).toEqual(["5"]);
    expectCreatedWith(result, preferred);
    expect(readiness(result)).toHaveLength(1);
    expect(result.stdout).toContain("pronto");
  });

  it("passa al mirror dopo tre download falliti senza cambiare versione", () => {
    const result = runRunner({ pullFailures: { [preferred]: 3 } });

    expect(result.status).toBe(0);
    expect(pulledImages(result)).toEqual([preferred, preferred, preferred, mirror]);
    expect(sleeps(result)).toEqual(["5", "10"]);
    expectCreatedWith(result, mirror);
  });

  it("fallisce dopo tre tentativi per registry senza creare o avviare un container", () => {
    const result = runRunner({ pullFailures: { [preferred]: 3, [mirror]: 3 } });

    expect(result.status).toBe(1);
    expect(pulledImages(result)).toEqual([preferred, preferred, preferred, mirror, mirror, mirror]);
    expect(sleeps(result)).toEqual(["5", "10", "5", "10"]);
    expect(dockerCalls(result, "run")).toHaveLength(0);
    expect(dockerCalls(result, "start")).toHaveLength(0);
    expect(readiness(result)).toHaveLength(0);
    expect(result.stdout).not.toContain("pronto");
  });

  it("usa la cache del secondo registry prima di tentare qualsiasi download", () => {
    const result = runRunner({ cachedImages: [mirror] });

    expect(result.status).toBe(0);
    expect(pulledImages(result)).toEqual([]);
    expect(sleeps(result)).toEqual([]);
    expectCreatedWith(result, mirror);
  });

  it("riavvia il container esistente senza pull o creazione", () => {
    const result = runRunner({ containerExists: true });

    expect(result.status).toBe(0);
    expect(pulledImages(result)).toEqual([]);
    expect(dockerCalls(result, "run")).toHaveLength(0);
    expect(dockerCalls(result, "start").map((call) => call.args)).toEqual([["start", "klokshift-pg"]]);
    expect(readiness(result)).toHaveLength(1);
  });

  it("propaga l'errore di start senza dichiarare il database pronto", () => {
    const result = runRunner({ containerExists: true, startFails: true });

    expect(result.status).toBe(1);
    expect(dockerCalls(result, "start")).toHaveLength(1);
    expect(readiness(result)).toHaveLength(0);
    expect(result.stdout).not.toContain("pronto");
  });

  it("fallisce dopo trenta controlli negativi e mostra i log del container", () => {
    const result = runRunner({ cachedImages: [preferred], readinessFailures: 30 });

    expect(result.status).toBe(1);
    expect(readiness(result)).toHaveLength(30);
    expect(dockerCalls(result, "logs")).toHaveLength(1);
    expect(dockerCalls(result, "logs")[0].args).toContain("klokshift-pg");
    expect(sleeps(result).length).toBeLessThanOrEqual(30);
    expect(sleeps(result).every((delay) => delay === "2")).toBe(true);
    expect(result.stdout).not.toContain("pronto");
  }, 15_000);

  it("attende pg_isready e dichiara successo soltanto quando risponde", () => {
    const result = runRunner({ containerExists: true, readinessFailures: 3 });

    expect(result.status).toBe(0);
    expect(readiness(result)).toHaveLength(4);
    expect(sleeps(result)).toEqual(["2", "2", "2"]);
    expect(result.stdout).toContain("pronto");
  });

  it("rileva il daemon indisponibile prima di ispezionare o scaricare immagini", () => {
    const result = runRunner({ daemonUnavailable: true });

    expect(result.status).toBe(1);
    expect(result.calls).toEqual([{ command: "docker", args: ["info"] }]);
    expect(result.stdout).not.toContain("pronto");
  });

  it("down senza container è innocuo e termina con successo", () => {
    const result = runRunner({}, "down");

    expect(result.status).toBe(0);
    expect(dockerCalls(result, "rm")).toHaveLength(0);
    expect(pulledImages(result)).toEqual([]);
  });
});
