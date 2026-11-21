// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.SESSION_SECRET ||= "test-secret";
  return { limit: vi.fn(), keyed: vi.fn(), consume: vi.fn(), cfg: vi.fn(), guild: vi.fn(), issue: vi.fn(), adminAllowed: vi.fn(), privileged: vi.fn() };
});
vi.mock("@/app/lib/rate-limit", () => ({
  enforceRateLimit: mocks.limit,
  checkKeyedRateLimit: mocks.keyed,
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
vi.mock("@/app/lib/settings/toggles", () => ({ toggleEnabled: (...a: unknown[]) => mocks.adminAllowed(...a) }));
vi.mock("@/app/lib/telegram/signin-privileged", () => ({ holdsPrivilegedRole: (...a: unknown[]) => mocks.privileged(...a) }));
vi.mock("@/app/lib/db", () => ({ prisma: {} }));
vi.mock("@/app/lib/telegram/signin-code", async (orig) => ({
  ...(await orig<typeof import("@/app/lib/telegram/signin-code")>()),
  consumeSignin: (...a: unknown[]) => mocks.consume(...a),
}));
vi.mock("@/app/lib/telegram/signin-settings", () => ({
  signinConfig: () => mocks.cfg(),
  signinAllowed: (c: { enabled: boolean; allowlist: string[] }, id: string) => c.enabled && (c.allowlist.length === 0 || c.allowlist.includes(id)),
}));
vi.mock("@/app/lib/discord", () => ({ lookupGuildMembership: (...a: unknown[]) => mocks.guild(...a) }));
vi.mock("@/app/lib/auth/issue-login-session", () => ({ issueLoginSession: (...a: unknown[]) => mocks.issue(...a) }));
vi.mock("@/app/lib/session", () => ({
  getSessionCookieOptions: () => ({ httpOnly: true, path: "/", sameSite: "lax" }),
  setSessionCookies: (res: { cookies: { set: (n: string, v: string, o: object) => void } }, token: string) => {
    res.cookies.set("pizzadao_session", token, { httpOnly: true, path: "/", sameSite: "lax" });
    return res;
  },
}));
import { GET } from "./route";

const COOKIE = `pd_tg_signin=${"A".repeat(43)}.${"B".repeat(43)}`;
const get = () => GET(new Request("https://app.example/api/auth/telegram/status", { headers: { cookie: COOKIE } }));
const setCookies = (res: Response) => res.headers.getSetCookie();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  mocks.limit.mockResolvedValue(null);
  mocks.cfg.mockResolvedValue({ enabled: true, allowlist: [], ttlMinutes: 5, claimSeconds: 120, sessionDays: 7 });
  mocks.keyed.mockResolvedValue({ success: true, limit: 300, remaining: 299, reset: Date.now() });
  mocks.adminAllowed.mockResolvedValue(false);
  mocks.privileged.mockResolvedValue(false);
  mocks.guild.mockResolvedValue({ status: "member", member: { nick: "Tony", roles: [], user: { id: "d1", username: "tony" } } });
  mocks.issue.mockResolvedValue({ token: "tg-session", memberId: "42", memberName: "Tony" });
  // Run the real precheck against the approved request for d1.
  mocks.consume.mockImplementation(async (_cookie: string, _now: number, precheck?: (id: string) => Promise<string | null>) => {
    const verdict = precheck ? await precheck("d1") : null;
    if (verdict === "retry") return { status: "pending" };
    if (verdict) return { status: "refused", reason: verdict };
    return { status: "approved", discordId: "d1", returnTo: "/profile/77" };
  });
});

describe("telegram sign-in status", () => {
  it("limits a browser by its own request (shared IPs do not collide), and the rest per IP", async () => {
    mocks.keyed.mockResolvedValue({ success: false, limit: 300, remaining: 0, reset: Date.now() + 1000 });
    expect((await get()).status).toBe(429);
    expect(mocks.keyed).toHaveBeenCalledWith("telegram-signin-status", expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
    mocks.limit.mockResolvedValue(new Response(null, { status: 429 }));
    const noCookie = await GET(new Request("https://app.example/api/auth/telegram/status"));
    expect(noCookie.status).toBe(429);
    expect(mocks.limit).toHaveBeenCalledWith(expect.any(Request), "telegram-signin-status");
  });

  it("refuses members holding admin, reviewer, payment or capo roles unless an admin allowed it", async () => {
    mocks.privileged.mockResolvedValue(true);
    const res = await get();
    expect(await res.json()).toEqual({ status: "error", code: "telegram_privileged" });
    expect(mocks.issue).not.toHaveBeenCalled();
    expect(setCookies(res).some((c) => c.startsWith("pizzadao_session="))).toBe(false);
    mocks.adminAllowed.mockResolvedValue(true);
    expect(((await (await get()).json()) as { status: string }).status).toBe("approved");
  });

  it("waits and retries when the saved role lists cannot be read", async () => {
    mocks.privileged.mockRejectedValue(new Error("db down"));
    expect(await (await get()).json()).toEqual({ status: "pending" });
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("gives Telegram sessions a shorter, absolute end", async () => {
    await get();
    const arg = mocks.issue.mock.calls[0][0] as { expiresAt: number };
    expect(arg.expiresAt - Date.now()).toBeGreaterThan(6.9 * 86400_000);
    expect(arg.expiresAt - Date.now()).toBeLessThan(7.1 * 86400_000);
  });

  it("signs in once: a telegram-marked session cookie, the cleaned landing path, and the request cookie cleared", async () => {
    const res = await get();
    expect(await res.json()).toEqual({ status: "approved", href: "/profile/77" });
    const cookies = setCookies(res);
    expect(cookies.filter((c) => c.startsWith("pizzadao_session=tg-session"))).toHaveLength(1);
    expect(cookies.some((c) => c.startsWith("pd_tg_signin=;") || /pd_tg_signin=;?/.test(c))).toBe(true);
    expect(mocks.issue).toHaveBeenCalledWith(expect.objectContaining({ discordId: "d1", authMethod: "telegram", nick: "Tony", username: "tony" }));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("lands an unlinked row in the wizard and a linked one on the dashboard", async () => {
    mocks.consume.mockResolvedValue({ status: "approved", discordId: "d1", returnTo: undefined });
    mocks.guild.mockResolvedValue({ status: "member", member: { nick: "Tony", roles: [], user: { id: "d1", username: "tony" } } });
    // consume mock above skips the precheck, so membership stays unset: still signs in, with no nick.
    expect(((await (await get()).json()) as { href: string }).href).toBe("/dashboard/42");
    mocks.issue.mockResolvedValue({ token: "tg-session" });
    expect(((await (await get()).json()) as { href: string }).href).toMatch(/discordId=d1/);
  });

  it("refuses a member who left the server and issues no session", async () => {
    mocks.guild.mockResolvedValue({ status: "not_member" });
    const res = await get();
    expect(await res.json()).toEqual({ status: "error", code: "telegram_left_server" });
    expect(mocks.issue).not.toHaveBeenCalled();
    expect(setCookies(res).some((c) => c.startsWith("pizzadao_session="))).toBe(false);
  });

  it("keeps waiting (no session, nothing spent) when Discord cannot be reached", async () => {
    mocks.guild.mockResolvedValue({ status: "unknown" });
    expect(await (await get()).json()).toEqual({ status: "pending" });
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("refuses when the switch was turned off, or the member left the tester list, mid-flight", async () => {
    mocks.cfg.mockResolvedValue({ enabled: false, allowlist: [], ttlMinutes: 5, claimSeconds: 120, sessionDays: 7 });
    expect(await (await get()).json()).toEqual({ status: "error", code: "telegram_unavailable" });
    mocks.cfg.mockResolvedValue({ enabled: true, allowlist: ["someone-else"], ttlMinutes: 5, claimSeconds: 120, sessionDays: 7 });
    expect(await (await get()).json()).toEqual({ status: "error", code: "telegram_unavailable" });
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("passes pending / cancelled / expired / none through without a session", async () => {
    for (const status of ["pending", "cancelled", "expired", "none"]) {
      mocks.consume.mockResolvedValue({ status });
      const res = await get();
      expect(await res.json()).toEqual({ status });
      expect(setCookies(res).some((c) => c.startsWith("pizzadao_session="))).toBe(false);
    }
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("never logs a Telegram id or the request secret", async () => {
    await get();
    const logged = vi.mocked(console.info).mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("signed_in");
    expect(logged).not.toContain("BBBB");
  });
});
