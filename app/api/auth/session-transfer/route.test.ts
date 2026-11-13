// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const create = vi.fn();
vi.mock("@/app/lib/db", () => ({ prisma: { consumedToken: { create: (a: unknown) => create(a) } } }));
const toggleEnabled = vi.fn();
vi.mock("@/app/lib/settings/toggles", () => ({ toggleEnabled: (k: string) => toggleEnabled(k) }));

const SITE = "https://pizzadao.org";
const session = { discordId: "123456789012345678", username: "u", nick: "n", createdAt: Date.now() };

async function setup() {
  vi.resetModules();
  vi.stubEnv("SESSION_SECRET", "test-secret");
  const route = await import("./route");
  const bridge = await import("@/app/lib/session-bridge");
  const proxyLib = await import("@/app/lib/oauth-proxy");
  const sess = await import("@/app/lib/session");
  return { GET: route.GET, bridge, proxyLib, sess };
}

const call = (GET: (r: Request) => Promise<Response>, url: string, cookie?: string) =>
  GET(new Request(url, { headers: cookie ? { cookie } : {} }));

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({});
  toggleEnabled.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe("session-transfer: bridge tokens", () => {
  it("starts a session and lands on the validated next path, spending the token and clearing the cookie", async () => {
    const { GET, bridge, sess } = await setup();
    const b = bridge.mintBridge(session, "/crew?x=1", SITE)!;
    const res = await call(GET, b.url, `pd_bridge=${b.jti}`);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://pizzadao.org/crew?x=1");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const cookies = res.headers.getSetCookie();
    const sessionCookie = cookies.find((c) => c.startsWith(`${sess.COOKIE_NAME}=`))!;
    expect(sess.verifySession(decodeURIComponent(sessionCookie.split(";")[0].split("=").slice(1).join("=")))?.discordId).toBe(session.discordId);
    expect(cookies.find((c) => c.startsWith("pd_bridge="))).toMatch(/Max-Age=0/i);
    expect(create).toHaveBeenCalledWith({ data: { tokenHash: bridge.bridgeTokenHash(b.jti), pollId: "session-bridge" } });
  });

  it("refuses a replay (token already spent) and does not sign in", async () => {
    const { GET, bridge, sess } = await setup();
    create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    const b = bridge.mintBridge(session, "/crew", SITE)!;
    const res = await call(GET, b.url, `pd_bridge=${b.jti}`);
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${sess.COOKIE_NAME}=`))).toBe(false);
    expect(res.headers.get("location")).toBe("https://pizzadao.org/crew"); // signed out, same page
  });

  it("fails closed when the spent-token store is down", async () => {
    const { GET, bridge, sess } = await setup();
    create.mockRejectedValue(new Error("db down"));
    const b = bridge.mintBridge(session, "/crew", SITE)!;
    const res = await call(GET, b.url, `pd_bridge=${b.jti}`);
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${sess.COOKIE_NAME}=`))).toBe(false);
  });

  it("needs the matching browser cookie (login CSRF): no cookie or another jti gets no session", async () => {
    const { GET, bridge, sess } = await setup();
    const b = bridge.mintBridge(session, "/crew", SITE)!;
    for (const cookie of [undefined, "pd_bridge=somebody-else"]) {
      const res = await call(GET, b.url, cookie);
      expect(res.headers.getSetCookie().some((c) => c.startsWith(`${sess.COOKIE_NAME}=`))).toBe(false);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("is refused while the switch is off", async () => {
    const { GET, bridge, sess } = await setup();
    toggleEnabled.mockResolvedValue(false);
    const b = bridge.mintBridge(session, "/crew", SITE)!;
    const res = await call(GET, b.url, `pd_bridge=${b.jti}`);
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${sess.COOKIE_NAME}=`))).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a token minted for another origin, and a forged one", async () => {
    const { GET, bridge, proxyLib, sess } = await setup();
    const other = proxyLib.createTransferToken({ discordId: "1", username: "", nick: "", origin: "https://app.pizzadao.org", jti: "j" });
    for (const token of [other, "forged.token"]) {
      const res = await call(GET, `${SITE}/api/auth/session-transfer?token=${encodeURIComponent(token)}&next=/crew`, "pd_bridge=j");
      expect(res.headers.getSetCookie().some((c) => c.startsWith(`${sess.COOKIE_NAME}=`))).toBe(false);
    }
    void bridge;
  });

  it("never follows an off-site or api next: falls back to home", async () => {
    const { GET, bridge } = await setup();
    for (const next of ["//evil.com", "https://evil.com", "/api/admin", "\\\\evil.com"]) {
      const b = bridge.mintBridge(session, "/crew", SITE)!;
      const u = new URL(b.url);
      u.searchParams.set("next", next);
      const res = await call(GET, u.toString(), `pd_bridge=${b.jti}`);
      expect(res.headers.get("location")).toBe("https://pizzadao.org/");
    }
  });
});

describe("session-transfer: preview proxy tokens (unchanged)", () => {
  it("accepts a plain token for this origin without a cookie or the switch", async () => {
    const { GET, proxyLib, sess } = await setup();
    toggleEnabled.mockResolvedValue(false);
    const token = proxyLib.createTransferToken({ discordId: "1", username: "u", nick: "n", origin: "https://onboarding-abc-pizza-dao.vercel.app" });
    const res = await call(GET, `https://onboarding-abc-pizza-dao.vercel.app/api/auth/session-transfer?token=${token}`);
    expect(res.headers.get("location")).toBe("https://onboarding-abc-pizza-dao.vercel.app/");
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${sess.COOKIE_NAME}=`))).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });
  it("on production, refuses a plain token aimed at this deployment (login CSRF) for every production origin", async () => {
    const { GET, proxyLib, sess } = await setup();
    vi.stubEnv("VERCEL_ENV", "production");
    for (const origin of ["https://app.pizzadao.org", "https://pizzadao.org"]) {
      const token = proxyLib.createTransferToken({ discordId: "1", username: "u", nick: "n", origin });
      const res = await call(GET, `${origin}/api/auth/session-transfer?token=${token}&next=/crew`);
      expect(res.status).toBe(403);
      expect(res.headers.getSetCookie().some((c) => c.startsWith(`${sess.COOKIE_NAME}=`))).toBe(false);
    }
  });
  it("off production, ignores next for a plain token", async () => {
    const { GET, proxyLib } = await setup();
    const o = "https://onboarding-abc-pizza-dao.vercel.app";
    const token = proxyLib.createTransferToken({ discordId: "1", username: "u", nick: "n", origin: o });
    const res = await call(GET, `${o}/api/auth/session-transfer?token=${token}&next=/crew`);
    expect(res.headers.get("location")).toBe(o + "/");
  });
  it("still answers JSON errors when there is no next", async () => {
    const { GET } = await setup();
    expect((await call(GET, `${SITE}/api/auth/session-transfer`)).status).toBe(400);
    expect((await call(GET, `${SITE}/api/auth/session-transfer?token=bad`)).status).toBe(401);
  });
});
