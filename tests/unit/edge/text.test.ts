import { describe, expect, it } from "vitest";
import { oneLine as mailLine } from "../../../supabase/functions/invite-staff/logic";
import { oneLine as accountLine } from "../../../supabase/functions/accept-invite/logic";

describe.each([["invite-staff", mailLine], ["accept-invite", accountLine]] as const)(
  "%s: testo su una riga",
  (_name, oneLine) => {
    it("sostituisce ogni controllo ASCII e DEL senza eliminarne la separazione", () => {
      for (const code of [...Array.from({ length: 32 }, (_, i) => i), 127]) {
        expect(oneLine(`Ada${String.fromCharCode(code)}Rossi`)).toBe("Ada Rossi");
      }
      expect(oneLine("  Ada\r\n\tRossi  ")).toBe("Ada Rossi");
    });
    it("preserva Unicode e caratteri da escapare nell'HTML", () => {
      expect(oneLine('  Société <R&D "Soci"> 🙂  ')).toBe('Société <R&D "Soci"> 🙂');
    });
  }
);
