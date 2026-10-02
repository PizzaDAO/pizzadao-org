import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();
const hasAnyRole = vi.fn();
vi.mock("@/app/lib/session", () => ({ getSession: () => getSession() }));
vi.mock("@/app/lib/discord", () => ({ hasAnyRole: (...a: unknown[]) => hasAnyRole(...a) }));

import {
  canAnnounce,
  getAnnounceAccessConfig,
  parseIdList,
  requireAnnouncer,
  LEGACY_ANNOUNCE_DISCORD_IDS,
} from "./access";

describe("announce access", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    getSession.mockReset();
    hasAnyRole.mockReset();
    process.env = { ...saved };
    delete process.env.ANNOUNCE_ROLE_IDS;
    delete process.env.ADMIN_ROLE_IDS;
  });

  it("parses comma-separated snowflakes and drops junk", () => {
    expect(parseIdList(" 111111, 222222 ,,abc, ")).toEqual(["111111", "222222"]);
    expect(parseIdList(undefined)).toEqual([]);
  });

  it("prefers ANNOUNCE_ROLE_IDS, then ADMIN_ROLE_IDS, then the legacy allowlist", () => {
    expect(getAnnounceAccessConfig({ ANNOUNCE_ROLE_IDS: "111111", ADMIN_ROLE_IDS: "222222" })).toEqual({
      mode: "roles",
      source: "ANNOUNCE_ROLE_IDS",
      roleIds: ["111111"],
    });
    expect(getAnnounceAccessConfig({ ADMIN_ROLE_IDS: "222222,333333" })).toEqual({
      mode: "roles",
      source: "ADMIN_ROLE_IDS",
      roleIds: ["222222", "333333"],
    });
    expect(getAnnounceAccessConfig({ ANNOUNCE_ROLE_IDS: " " })).toEqual({
      mode: "legacy-users",
      source: "legacy",
      discordIds: LEGACY_ANNOUNCE_DISCORD_IDS,
    });
  });

  it("role mode checks guild roles via hasAnyRole", async () => {
    hasAnyRole.mockResolvedValue(true);
    const cfg = { mode: "roles", source: "ANNOUNCE_ROLE_IDS", roleIds: ["111111"] } as const;
    expect(await canAnnounce("u1", { ...cfg, roleIds: [...cfg.roleIds] })).toBe(true);
    expect(hasAnyRole).toHaveBeenCalledWith("u1", ["111111"]);
  });

  it("role mode fails closed when the Discord lookup throws", async () => {
    hasAnyRole.mockRejectedValue(new Error("discord down"));
    expect(await canAnnounce("u1", { mode: "roles", source: "ADMIN_ROLE_IDS", roleIds: ["1"] })).toBe(false);
  });

  it("legacy mode uses the user allowlist without calling Discord", async () => {
    const cfg = getAnnounceAccessConfig({});
    expect(await canAnnounce(LEGACY_ANNOUNCE_DISCORD_IDS[0], cfg)).toBe(true);
    expect(await canAnnounce("999999", cfg)).toBe(false);
    expect(hasAnyRole).not.toHaveBeenCalled();
  });

  it("requireAnnouncer: 401 without session, 403 without role, ok with role", async () => {
    process.env.ANNOUNCE_ROLE_IDS = "111111";

    getSession.mockResolvedValue(null);
    let r = await requireAnnouncer();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);

    getSession.mockResolvedValue({ discordId: "u1", createdAt: Date.now() });
    hasAnyRole.mockResolvedValue(false);
    r = await requireAnnouncer();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);

    hasAnyRole.mockResolvedValue(true);
    r = await requireAnnouncer();
    expect(r.ok).toBe(true);
    expect(hasAnyRole).toHaveBeenLastCalledWith("u1", ["111111"]);
  });

  it("with ADMIN_ROLE_IDS only, the legacy user is no longer allowed without the role", async () => {
    process.env.ADMIN_ROLE_IDS = "222222";
    getSession.mockResolvedValue({ discordId: LEGACY_ANNOUNCE_DISCORD_IDS[0], createdAt: Date.now() });
    hasAnyRole.mockResolvedValue(false);
    const r = await requireAnnouncer();
    expect(r.ok).toBe(false);
    expect(hasAnyRole).toHaveBeenCalledWith(LEGACY_ANNOUNCE_DISCORD_IDS[0], ["222222"]);
  });
});
