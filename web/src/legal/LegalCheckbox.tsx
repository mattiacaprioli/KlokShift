import { LEGAL_URLS } from "@/features/account/legal";
import { LEGAL_COPY } from "@/features/legal/copy";

/**
 * La casella dei form che aprono un'azienda, gemella di quella dell'app
 * (`src/features/legal/LegalCheckbox.tsx`): non preselezionata, e senza di lei
 * il pulsante resta spento.
 */
export function LegalCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 text-left">
      <label className="flex items-start gap-2 text-sm leading-5 text-t2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-gold)]"
        />
        {LEGAL_COPY.checkbox}
      </label>
      <LegalDocLinks />
    </div>
  );
}

export function LegalDocLinks() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 pl-6 text-sm">
      <a href={LEGAL_URLS.terms} target="_blank" rel="noreferrer" className="focus-gold text-gold hover:underline">
        {LEGAL_COPY.terms}
      </a>
      <a href={LEGAL_URLS.dpa} target="_blank" rel="noreferrer" className="focus-gold text-gold hover:underline">
        {LEGAL_COPY.dpa}
      </a>
    </div>
  );
}
