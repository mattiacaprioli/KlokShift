import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteMyAccount } from "@/features/account/api";
import { UserFacingError } from "@/lib/errors";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke },
  },
}));

describe("contratto client della cancellazione account", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("conclude soltanto quando file e identità Auth sono stati eliminati", async () => {
    invoke.mockResolvedValue({
      data: { deleted: true, retryable: false },
      error: null,
    });

    await expect(deleteMyAccount()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("delete-account", { method: "POST" });
  });

  it("spiega che la stessa operazione è sicura da ritentare", async () => {
    invoke.mockResolvedValue({
      data: {
        deleted: false,
        retryable: true,
        error: "storage_cleanup_pending",
      },
      error: null,
    });

    const promise = deleteMyAccount();
    await expect(promise).rejects.toBeInstanceOf(UserFacingError);
    await expect(promise).rejects.toThrow(
      "La cancellazione non è ancora completa. Riprova"
    );
  });

  it("non scambia un errore di trasporto per una cancellazione riuscita", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: "network failed" },
    });

    await expect(deleteMyAccount()).rejects.toThrow("network failed");
  });
});
