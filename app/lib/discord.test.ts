import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("discord.ts without bot config", () => {
  const fetchSpy = vi.fn();
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DISCORD_GUILD_ID", "");
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    vi.stubGlobal("fetch", fetchSpy);
    fetchSpy.mockReset();
    warnSpy.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("short-circuits every lookup without calling Discord and warns once", async () => {
    const d = await import("./discord");
    expect(await d.fetchGuildMember("1")).toBeNull();
    expect(await d.lookupGuildMembership("1")).toEqual({ status: "unknown" });
    expect(await d.hasRole("1", "r")).toBe(false);
    expect(await d.searchGuildMembers("pizza")).toEqual([]);
    expect(await d.getMembersWithRoles(["r"])).toEqual([]);
    expect(await d.sendDM("1", "hi")).toEqual({ success: false, error: "discord_not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("short-circuits when only the guild ID is missing", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "tok");
    const d = await import("./discord");
    expect(await d.lookupGuildMembership("1")).toEqual({ status: "unknown" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
