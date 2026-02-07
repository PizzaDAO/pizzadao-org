import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncRolesOnLogin } from "./sync-roles-on-login";

describe("syncRolesOnLogin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn();
  });

  it("calls /api/discord/sync-to-sheet with discordId, memberId, and name", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => "{}",
    });

    await syncRolesOnLogin("https://pizzadao.org", "12345", "100", "TestUser");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://pizzadao.org/api/discord/sync-to-sheet",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discordId: "12345",
          memberId: "100",
          mafiaName: "TestUser",
        }),
      })
    );
  });

  it("calls /api/discord/sync-to-sheet without optional params", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => "{}",
    });

    await syncRolesOnLogin("https://pizzadao.org", "12345");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://pizzadao.org/api/discord/sync-to-sheet",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          discordId: "12345",
          memberId: undefined,
          mafiaName: undefined,
        }),
      })
    );
  });

  it("does not throw when fetch rejects (network error)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network failure")
    );

    // Should resolve without throwing
    await expect(
      syncRolesOnLogin("https://pizzadao.org", "12345")
    ).resolves.toBeUndefined();
  });

  it("does not throw when the API returns an error status", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '{"error":"Internal Server Error"}',
    });

    await expect(
      syncRolesOnLogin("https://pizzadao.org", "12345")
    ).resolves.toBeUndefined();
  });

  it("logs an error when the API returns an error status", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '{"error":"boom"}',
    });

    await syncRolesOnLogin("https://pizzadao.org", "12345");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[syncRolesOnLogin]")
    );
  });

  it("logs an error when fetch throws", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network failure")
    );

    await syncRolesOnLogin("https://pizzadao.org", "12345");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[syncRolesOnLogin]"),
      expect.any(Error)
    );
  });
});
