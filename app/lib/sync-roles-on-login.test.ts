import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSync = vi.fn();
vi.mock("./discord-sheet-sync", () => ({
  syncDiscordRolesToSheet: (...args: unknown[]) => mockSync(...args),
}));

import { syncRolesOnLogin } from "./sync-roles-on-login";

describe("syncRolesOnLogin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSync.mockReset();
  });

  it("calls the sync library with discordId and name", async () => {
    mockSync.mockResolvedValue({ ok: true });
    await syncRolesOnLogin("12345", "TestUser");
    expect(mockSync).toHaveBeenCalledWith("12345", "TestUser");
  });

  it("calls the sync library without the optional name", async () => {
    mockSync.mockResolvedValue({ ok: true });
    await syncRolesOnLogin("12345");
    expect(mockSync).toHaveBeenCalledWith("12345", undefined);
  });

  it("does not throw and logs when the sync fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSync.mockRejectedValue(new Error("boom"));
    await expect(syncRolesOnLogin("12345")).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[syncRolesOnLogin]"),
      expect.any(Error),
    );
  });
});
