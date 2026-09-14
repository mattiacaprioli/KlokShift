/*
 * Un `cn` minimo. La dashboard usa `clsx` + `tailwind-merge` perché compone
 * varianti a runtime; qui le classi sono statiche e si concatenano soltanto:
 * una dipendenza in meno nel bundle della vetrina.
 */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
