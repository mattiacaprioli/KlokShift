import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sito e dashboard servono i font da sé: caricarli da Google manderebbe
 * l'indirizzo IP di ogni visitatore a un fornitore non dichiarato
 * (spec DPA §6.4). Vale per gli HTML d'ingresso e per ogni CSS.
 */
const root = resolve(process.cwd());
const ENTRIES = ["web/index.html", "web-site/index.html", "web-site/invito.html"];
const CSS_DIRS = ["web/src", "web-site/src", "shared"];

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : cssFiles(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

describe("font senza Google", () => {
  const files = [
    ...ENTRIES.map((f) => join(root, f)),
    ...CSS_DIRS.flatMap((d) => cssFiles(join(root, d))),
  ];

  it("legge davvero i file", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it("nessun file carica font da Google", () => {
    const offending = files.filter((f) =>
      /fonts\.(googleapis|gstatic)\.com/.test(readFileSync(f, "utf8"))
    );
    expect(offending.map((f) => f.replace(root + "/", ""))).toEqual([]);
  });
});
