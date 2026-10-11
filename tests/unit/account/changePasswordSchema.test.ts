import { describe, expect, it } from "vitest";
import {
  changePasswordSchema,
  passwordMismatchMessage,
  passwordUnchangedMessage,
} from "@/features/auth/schema";

const valid = {
  currentPassword: "Vecchia2026",
  password: "Nuova2026x",
  confirmPassword: "Nuova2026x",
};

function firstIssue(input: typeof valid) {
  const res = changePasswordSchema.safeParse(input);
  return res.success ? null : res.error.issues[0];
}

describe("changePasswordSchema", () => {
  it("accetta una password nuova valida, ripetuta e diversa dall'attuale", () => {
    expect(changePasswordSchema.safeParse(valid).success).toBe(true);
  });

  it("chiede la password attuale", () => {
    expect(firstIssue({ ...valid, currentPassword: "" })?.path).toEqual([
      "currentPassword",
    ]);
  });

  it("applica le stesse regole della registrazione", () => {
    const issue = firstIssue({
      ...valid,
      password: "corta",
      confirmPassword: "corta",
    });
    expect(issue?.path).toEqual(["password"]);
  });

  it("rifiuta due password nuove diverse", () => {
    const issue = firstIssue({ ...valid, confirmPassword: "Nuova2026y" });
    expect(issue?.message).toBe(passwordMismatchMessage);
  });

  it("rifiuta una password nuova uguale all'attuale", () => {
    const issue = firstIssue({
      currentPassword: "Uguale2026",
      password: "Uguale2026",
      confirmPassword: "Uguale2026",
    });
    expect(issue?.message).toBe(passwordUnchangedMessage);
  });
});
