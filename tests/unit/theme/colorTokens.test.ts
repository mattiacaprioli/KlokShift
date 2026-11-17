import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { darkColors, withAlpha } from "@/constants/colors";

/**
 * I colori hanno due fonti gemelle: i token `@theme` dei CSS (classi Tailwind)
 * e `darkColors` (prop JS, letti con `useColors()`). Questo test le tiene
 * allineate e impedisce di riscrivere colori a mano nell'app: è ciò che rende
 * possibile il tema chiaro cambiando solo i token.
 */
const ROOT = resolve(__dirname, "../../..");

const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const norm = (v: string) => v.toLowerCase().replace(/\s+/g, "");

function themeColors(cssFile: string): Record<string, string> {
  const css = readFileSync(join(ROOT, cssFile), "utf8");
  const theme = /@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const m of theme.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) out[camel(m[1])] = m[2].trim();
  return out;
}

/** File che possono contenere colori scritti: le fonti e ciò che non segue il tema. */
const ALLOWED = [
  "src/constants/colors.ts", // la fonte
  "src/lib/exportBuilders.ts", // PDF da stampare: sempre chiaro
  "src/features/venues/venueColor.ts", // colore d'identità della sede
  "src/components/ui/Avatar.tsx", // fondi d'identità delle iniziali
  "src/types/",
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("token di colore", () => {
  for (const css of ["src/global.css", "web/src/index.css"]) {
    it(`${css} e darkColors hanno gli stessi valori`, () => {
      const tokens = themeColors(css);
      expect(Object.keys(tokens).length).toBeGreaterThan(10);
      for (const [key, value] of Object.entries(tokens)) {
        expect(darkColors, `--color-${key} manca in darkColors`).toHaveProperty(key);
        expect(norm(darkColors[key as keyof typeof darkColors]), `--color-${key}`).toBe(norm(value));
      }
    });
  }

  it("nessun colore scritto a mano in src/", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(ROOT, "src"))) {
      const rel = relative(ROOT, file);
      if (ALLOWED.some((a) => rel.startsWith(a))) continue;
      const lines = stripComments(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        if (/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?!-)|rgba?\(/.test(line)) offenders.push(`${rel}:${i + 1} ${line.trim()}`);
      });
    }
    expect(offenders, "usa useColors() / withAlpha o una classe del tema").toEqual([]);
  });

  it("withAlpha produce la trasparenza del token", () => {
    expect(withAlpha(darkColors.warning, 0.15)).toBe("rgba(226,146,47,0.15)");
    expect(() => withAlpha("rgba(0,0,0,1)", 0.5)).toThrow();
  });
});
