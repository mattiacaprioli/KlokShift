import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { darkColors, lightColors, withAlpha, type ColorToken, type ThemeColors } from "@/constants/colors";

/**
 * I colori hanno due fonti gemelle: i token dei CSS (classi Tailwind) e
 * `lightColors`/`darkColors` (prop JS, letti con `useColors()`). Nei CSS il
 * chiaro sta in `@theme` e lo scuro nei blocchi `prefers-color-scheme: dark`
 * (e `data-theme="dark"` sulla dashboard). Questo test le tiene allineate,
 * controlla i contrasti e impedisce di riscrivere colori a mano nell'app.
 */
const ROOT = resolve(__dirname, "../../..");

const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const norm = (v: string) => v.toLowerCase().replace(/\s+/g, "");

function colorDecls(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) out[camel(m[1])] = m[2].trim();
  return out;
}

/** Il chiaro (`@theme`) e ogni blocco scuro del file. */
function cssThemes(cssFile: string): { light: Record<string, string>; dark: Record<string, string>[] } {
  const css = readFileSync(join(ROOT, cssFile), "utf8");
  const light = colorDecls(/@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "");
  const dark = [...css.matchAll(/(?:prefers-color-scheme:\s*dark\)|\[data-theme="dark"\])\s*\{([\s\S]*?)\n\}/g)].map((m) =>
    colorDecls(m[1]),
  );
  return { light, dark };
}

function expectSame(tokens: Record<string, string>, theme: ThemeColors, label: string) {
  expect(Object.keys(tokens).length, label).toBeGreaterThan(10);
  for (const [key, value] of Object.entries(tokens)) {
    expect(theme, `${label}: --color-${key} manca`).toHaveProperty(key);
    expect(norm(theme[key as ColorToken]), `${label}: --color-${key}`).toBe(norm(value));
  }
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
  for (const [css, darkBlocks] of [["src/global.css", 1], ["web/src/index.css", 2]] as const) {
    it(`${css}: @theme = lightColors, i blocchi scuri = darkColors`, () => {
      const { light, dark } = cssThemes(css);
      expectSame(light, lightColors, "chiaro");
      expect(dark).toHaveLength(darkBlocks);
      dark.forEach((block, i) => expectSame(block, darkColors, `scuro ${i + 1}`));
      // Ogni token del chiaro ha il suo scuro: nessuno resta uguale per dimenticanza.
      for (const block of dark) expect(Object.keys(block).sort()).toEqual(Object.keys(light).sort());
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

  /** Contrasto WCAG fra due `#RRGGBB`. */
  const contrast = (a: string, b: string) => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const v = parseInt(hex.slice(i, i + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  /** [testo, fondo, minimo]: 4,5 è il WCAG AA del testo normale. */
  const READABLE: [ColorToken, ColorToken, number][] = [
    ["t1", "bg0", 4.5], ["t1", "bgCard", 4.5],
    ["t2", "bg0", 4.5], ["t2", "bgCard", 4.5],
    ["t3", "bg0", 4.5], ["t3", "bgCard", 4.5],
    ["t4", "bgCard", 3], // il grigio spento: uguale nei due temi
    ["gold", "bg0", 4.5], ["gold", "bgCard", 4.5],
    ["goldInk", "goldFill", 4.5], ["goldInk", "goldDeep", 4.5],
    ["success", "bgCard", 4.5], ["warning", "bgCard", 4.5], ["error", "bgCard", 4.5],
    ["white", "error", 3],
  ];

  for (const [name, theme] of [["scuro", darkColors], ["chiaro", lightColors]] as [string, ThemeColors][]) {
    it(`tema ${name}: i testi si leggono`, () => {
      const low = READABLE.filter(([fg, bg, min]) => contrast(theme[fg], theme[bg]) < min).map(
        ([fg, bg, min]) => `${fg} su ${bg}: ${contrast(theme[fg], theme[bg]).toFixed(2)} < ${min}`,
      );
      expect(low).toEqual([]);
    });
  }

  it("withAlpha produce la trasparenza del token", () => {
    expect(withAlpha(darkColors.warning, 0.15)).toBe("rgba(226,146,47,0.15)");
    expect(() => withAlpha("rgba(0,0,0,1)", 0.5)).toThrow();
  });
});
