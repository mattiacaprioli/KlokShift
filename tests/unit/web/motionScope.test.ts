import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Motion serve solo alle animazioni del sito vetrina: nell'app nativa e nella
 * dashboard sarebbe peso senza motivo (e nell'app un'altra libreria di
 * animazione accanto a Reanimated).
 */
const root = resolve(process.cwd());
const IMPORTS_MOTION = /from\s+["']motion(\/|["'])/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const importers = (dir: string) =>
  sources(join(root, dir))
    .filter((f) => IMPORTS_MOTION.test(readFileSync(f, "utf8")))
    .map((f) => f.replace(root + "/", ""));

describe("motion solo nel sito vetrina", () => {
  it("app, dashboard e shared non importano motion", () => {
    expect(["src", "web/src", "shared"].flatMap(importers)).toEqual([]);
  });

  it("il sito vetrina lo usa davvero", () => {
    // Senza questa guardia uno scanner rotto farebbe passare il test sopra a vuoto.
    expect(importers("web-site/src").length).toBeGreaterThan(0);
  });
});
