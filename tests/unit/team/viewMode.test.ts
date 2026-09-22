import { describe, expect, it } from "vitest";

import { resolvedViewMode } from "@/features/team/viewModeLogic";

describe("resolvedViewMode", () => {
  it.each([
    {
      label: "gestione e lavoro, preferenza gestione",
      canManage: true,
      canWork: true,
      onboardingComplete: true,
      savedMode: "manager" as const,
      expected: { effective: "manager", canSwitch: true },
    },
    {
      label: "gestione e lavoro, preferenza personale",
      canManage: true,
      canWork: true,
      onboardingComplete: true,
      savedMode: "waiter" as const,
      expected: { effective: "waiter", canSwitch: true },
    },
    {
      label: "gestione e onboarding, senza organico attivo",
      canManage: true,
      canWork: false,
      onboardingComplete: true,
      savedMode: "waiter" as const,
      expected: { effective: "waiter", canSwitch: true },
    },
    {
      label: "solo gestione senza profilo personale",
      canManage: true,
      canWork: false,
      onboardingComplete: false,
      savedMode: "waiter" as const,
      expected: { effective: "manager", canSwitch: false },
    },
    {
      label: "solo lavoro",
      canManage: false,
      canWork: true,
      onboardingComplete: false,
      savedMode: "manager" as const,
      expected: { effective: "waiter", canSwitch: false },
    },
    {
      label: "profilo personale senza gestione né organico attivo",
      canManage: false,
      canWork: false,
      onboardingComplete: true,
      savedMode: "manager" as const,
      expected: { effective: "waiter", canSwitch: false },
    },
    {
      label: "account nuovo usa l'intento",
      canManage: false,
      canWork: false,
      onboardingComplete: false,
      savedMode: null,
      expected: { effective: "manager", canSwitch: false },
    },
  ])("risolve $label", ({ expected, ...input }) => {
    expect(resolvedViewMode({ ...input, intent: "manager" })).toEqual(expected);
  });

  it("non trascina la preferenza waiter da A a B e segue la revoca", () => {
    const accountA = resolvedViewMode({
      canManage: true,
      canWork: true,
      onboardingComplete: true,
      savedMode: "waiter",
      intent: "manager",
    });
    const accountB = resolvedViewMode({
      canManage: true,
      canWork: false,
      onboardingComplete: false,
      savedMode: null,
      intent: "manager",
    });
    const afterRevoke = resolvedViewMode({
      canManage: false,
      canWork: true,
      onboardingComplete: true,
      savedMode: "manager",
      intent: "manager",
    });

    expect(accountA.effective).toBe("waiter");
    expect(accountB.effective).toBe("manager");
    expect(afterRevoke).toEqual({ effective: "waiter", canSwitch: false });
  });
});
