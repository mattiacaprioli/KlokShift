Review completa del codice corrente di KlokShift.

Lancia in parallelo i seguenti subagent (Agent tool):
1. **code-reviewer** — qualità del codice, SRP, DRY, naming, error handling
2. **principles-enforcer** — conformità ai principi KlokShift (NativeWind via `@/tw`, no Tamagui, data layer Supabase, Stack.Protected, gotcha `<Link>`, path alias `@/`)
3. **techdebt-analyzer** — tech debt, componenti grandi, duplicazione, dead code, TODO, pattern obsoleti

Se $ARGUMENTS contiene un path, limita l'analisi a quei file o cartelle.
Altrimenti analizza tutto `src/` (in particolare `src/app/`, `src/components/`, `src/lib/`).

Al termine, consolida i risultati eliminando i duplicati e classifica tutto per priorità:
- **CRITICAL** — bug o violazione grave, blocca la PR
- **HIGH** — problema importante da risolvere prima del merge
- **MEDIUM** — da pianificare nel prossimo milestone
- **LOW** — nice-to-have, refactoring opzionale
