import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collectUserStrings } from "../helpers/userStrings";

/**
 * Il glossario (docs/GLOSSARIO.md) applicato ai testi: una parola per concetto,
 * nessuna parola da ufficio. Si leggono le stringhe e il testo JSX, mai i
 * commenti; una stringa senza spazi e tutta minuscola è una chiave o una rotta
 * («staff», «/staff», «organico» come id di tab) e non si guarda.
 */
const FORBIDDEN: { word: RegExp; use: string }[] = [
  { word: /\borganic[oi]\b/i, use: "team" },
  { word: /\bstaff\b/i, use: "team" },
  { word: /\bpersonale\b/i, use: "team" },
  { word: /\bprofessionist[ai]\b/i, use: "dipendente" },
  { word: /\bmansion[ei]\b/i, use: "ruolo" },
  { word: /\bfabbisogn[oi]\b/i, use: "persone che servono" },
  { word: /\boperatività\b/i, use: "l'azienda non è più attiva / attiva fino al" },
  { word: /\bcapacità\b/i, use: "limite del piano" },
  { word: /\bpregress[ei]\b/i, use: "passate" },
  { word: /\bconsuntivo\b/i, use: "riepilogo ore" },
  { word: /\banagrafica\b/i, use: "dati personali" },
  { word: /\bdatore di lavoro\b/i, use: "la sede / il titolare" },
  { word: /\bcollaborator[ei] a chiamata\b/i, use: "chi è a chiamata" },
  { word: /\bfinestra di timbratura\b/i, use: "è tardi per timbrare" },
  { word: /\bprova Team\b/, use: "la prova gratuita (il piano si scrive «piano Team»)" },
  { word: /\bplanning\b/i, use: "turni" },
];

/** Eccezioni motivate: file + frammento del testo. */
const ALLOWED: { file: string; text: string; why: string }[] = [
  // Messaggi che legge solo il fondatore, per concedere quote e capacità.
  { file: "src/lib/errors.ts", text: "concedere la capacità", why: "area del fondatore" },
  { file: "src/lib/errors.ts", text: "Scegli capacità valide", why: "area del fondatore" },
];

/** Chiavi, rotte (anche con parametri) e liste di colonne per le select. */
const isKey = (text: string) =>
  text.trimStart().startsWith("/") ||
  /^[a-z_]+:[a-z_]+!/.test(text.trim()) ||
  (!/\s/.test(text.trim()) && text === text.toLowerCase());

describe("glossario", () => {
  const strings = collectUserStrings(resolve(process.cwd()), [
    "src",
    "web/src",
    "shared",
    "web-site/src",
  ]);

  it("legge davvero i testi dell'app", () => {
    // Se lo scanner si rompe e non trova niente, il test sotto passerebbe a vuoto.
    expect(strings.length).toBeGreaterThan(2000);
    expect(strings.some((s) => s.text.includes("Aggiungi al team"))).toBe(true);
  });

  it("non usa parole fuori dal glossario", () => {
    const offending = strings
      .filter((s) => !isKey(s.text))
      .flatMap((s) =>
        FORBIDDEN.filter(({ word }) => word.test(s.text)).map(
          ({ word, use }) => ({ ...s, word: word.source, use })
        )
      )
      .filter((hit) => !ALLOWED.some((a) => hit.file === a.file && hit.text.includes(a.text)))
      .map((hit) => `${hit.file}:${hit.line} «${hit.text.trim().slice(0, 80)}» → usa «${hit.use}»`);
    expect(offending).toEqual([]);
  });
});
