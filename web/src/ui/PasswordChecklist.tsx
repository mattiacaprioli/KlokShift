import { passwordRules } from "@/features/auth/schema";
import { cn } from "@/lib/cn";

/**
 * I requisiti della password che si spuntano mentre si scrive.
 *
 * Estratta quando le pagine che ne avevano bisogno sono diventate tre
 * (registrazione, nuova password, invito): lo stesso markup copiato tre volte si
 * sarebbe disallineato alla prima modifica, e le regole sono già un'unica
 * sorgente di verità in `src/features/auth/schema.ts`.
 *
 * Il gemello mobile è `src/features/auth/PasswordChecklist.tsx`: stesso nome e
 * stessa prop, markup diverso perché là sono `View`/`Text`.
 */
export function PasswordChecklist({ value }: { value: string }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {passwordRules.map((rule) => {
        const ok = rule.test(value);
        return (
          <li
            key={rule.label}
            className={cn(
              "flex items-center gap-2 text-xs",
              ok ? "text-success" : "text-t3"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full text-[9px] font-bold",
                ok
                  ? "bg-success text-bg-0"
                  : "border border-border-2 text-transparent"
              )}
            >
              ✓
            </span>
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}
