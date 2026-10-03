import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();
const hasAnyRole = vi.fn();
const runAnnouncementFromEnv = vi.fn();
vi.mock("@/app/lib/session", () => ({ getSession: () => getSession() }));
vi.mock("@/app/lib/discord", () => ({ hasAnyRole: (...a: unknown[]) => hasAnyRole(...a) }));
vi.mock("@/app/lib/announce/run", () => ({ runAnnouncementFromEnv: () => runAnnouncementFromEnv() }));
const getAnnounceBotCheck = vi.fn();
vi.mock("@/app/lib/announce/bot-check", () => ({ getAnnounceBotCheck: () => getAnnounceBotCheck() }));

import { GET, POST } from "./route";

describe("/api/announce", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    getSession.mockReset();
    hasAnyRole.mockReset();
    runAnnouncementFromEnv.mockReset();
    getAnnounceBotCheck.mockReset();
    getAnnounceBotCheck.mockResolvedValue({ configured: true, via: "webhook" });
    process.env = { ...saved, ANNOUNCE_ROLE_IDS: "111111" };
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("POST 401 without a session and never fires", async () => {
    getSession.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(runAnnouncementFromEnv).not.toHaveBeenCalled();
  });

  it("POST 403 without the announce role and never fires", async () => {
    getSession.mockResolvedValue({ discordId: "u1", createdAt: Date.now() });
    hasAnyRole.mockResolvedValue(false);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(runAnnouncementFromEnv).not.toHaveBeenCalled();
  });

  it("POST fires for role holders and passes the result through", async () => {
    getSession.mockResolvedValue({ discordId: "u1", username: "shaun", createdAt: Date.now() });
    hasAnyRole.mockResolvedValue(true);
    runAnnouncementFromEnv.mockResolvedValue({ status: 200, body: { success: true, sentAt: "2026-10-02 14:00:00" } });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, sentAt: "2026-10-02 14:00:00" });
    expect(hasAnyRole).toHaveBeenCalledWith("u1", ["111111"]);
  });

  it("POST returns 500 if the run throws", async () => {
    getSession.mockResolvedValue({ discordId: "u1", createdAt: Date.now() });
    hasAnyRole.mockResolvedValue(true);
    runAnnouncementFromEnv.mockRejectedValue(new Error("boom"));
    const res = await POST();
    expect(res.status).toBe(500);
  });

  it("GET reports access without exposing the list", async () => {
    getSession.mockResolvedValue({ discordId: "u1", createdAt: Date.now() });
    hasAnyRole.mockResolvedValue(true);
    let res = await GET();
    expect(await res.json()).toEqual({ allowed: true, botCheck: { configured: true, via: "webhook" } });

    hasAnyRole.mockResolvedValue(false);
    getAnnounceBotCheck.mockClear();
    res = await GET();
    expect(await res.json()).toEqual({ allowed: false });
    // Non-announcers never trigger the Discord permission check.
    expect(getAnnounceBotCheck).not.toHaveBeenCalled();

    getSession.mockResolvedValue(null);
    res = await GET();
    expect(res.status).toBe(401);
  });
});
