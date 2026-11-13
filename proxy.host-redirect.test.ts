// @vitest-environment node
// Old app host -> main site redirect and session bridge, in proxy.ts. SITE_URL is read when the module loads,
// so each test group imports a fresh copy under the env it needs.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/db");
vi.mock("@/app/lib/disavow/access", () => ({ disavowViewer: vi.fn(), findSubjectDisavowals: vi.fn() }));
vi.mock("@/app/lib/session", () => ({ COOKIE_NAME: "pizzadao_session", verifySession: vi.fn() }));

const flags: Record<string, unknown> = {};
const loadSettings = vi.fn();
vi.mock("@/app/lib/settings", () => ({ loadSettings: () => loadSettings() }));
vi.mock("@/app/lib/disavow/constants", () => ({ disavowEnabled: async () => false }));

const settingsWith = (o: Record<string, boolean>) => ({
  get: (k: string) => o[k] ?? false,
  isSet: (k: string) => k in o,
  readFailed: false,
  invalidKeys: [],
});

async function load(siteUrl?: string) {
  vi.resetModules();
  if (siteUrl) vi.stubEnv("NEXT_PUBLIC_APP_URL", siteUrl);
  else vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
  const mod = await import("./proxy");
  const session = await import("@/app/lib/session");
  return { ...mod, verifySession: session.verifySession as ReturnType<typeof vi.fn> };
}

const req = (url: string, init: { headers?: Record<string, string>; method?: string } = {}) =>
  new NextRequest(url, { method: init.method, headers: { host: new URL(url).host, ...(init.headers ?? {}) } });
const redirectedTo = (r: Response) => r.headers.get("location");
const passed = (r: Response) => r.headers.get("x-middleware-next") === "1";

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(flags)) delete flags[k];
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("SESSION_SECRET", "test-secret");
  vi.stubEnv("SITE_HOST_REDIRECT_ENABLED", "");
  vi.stubEnv("SITE_SESSION_BRIDGE_ENABLED", "");
  loadSettings.mockResolvedValue(settingsWith({ "site.hostRedirectEnabled": true }));
});
afterEach(() => vi.unstubAllEnvs());

describe("proxy matcher", () => {
  it("covers page paths and leaves api, _next, _vercel and .well-known out", async () => {
    const { config } = await load();
    const rule = config.matcher[2] as { source: string; has: unknown[] };
    expect(rule.has).toEqual([{ type: "host", value: "app.pizzadao.org" }]);
    const re = new RegExp("^" + rule.source.replace("/((?!", "/(?!").replace(/\)\.\*\)$/, ").*") + "$");
    expect(re.test("/")).toBe(true);
    expect(re.test("/crew")).toBe(true);
    expect(re.test("/apiary")).toBe(true);
    for (const p of ["/api/x", "/api", "/_next/static/a.js", "/_vercel/x", "/.well-known/x", "/brand-kit/a.png", "/robots.txt"]) expect(re.test(p)).toBe(false);
  });
});

describe("a build that still has the old SITE_URL", () => {
  it("never redirects, even with the switch on, and does not read settings", async () => {
    const { proxy } = await load();
    const r = await proxy(req("https://app.pizzadao.org/crew"));
    expect(passed(r)).toBe(true);
    expect(loadSettings).not.toHaveBeenCalled();
  });
});

describe("apex build, old host", () => {
  it("switch off: no redirect", async () => {
    loadSettings.mockResolvedValue(settingsWith({}));
    const { proxy } = await load("https://pizzadao.org");
    expect(passed(await proxy(req("https://app.pizzadao.org/crew")))).toBe(true);
  });
  it("env off wins over a saved ON", async () => {
    vi.stubEnv("SITE_HOST_REDIRECT_ENABLED", "off");
    const { proxy } = await load("https://pizzadao.org");
    expect(passed(await proxy(req("https://app.pizzadao.org/crew")))).toBe(true);
  });
  it("unreadable settings: no redirect", async () => {
    loadSettings.mockRejectedValue(new Error("db down"));
    const { proxy } = await load("https://pizzadao.org");
    expect(passed(await proxy(req("https://app.pizzadao.org/crew")))).toBe(true);
  });
  it("/ goes to /start, keeping the query, with a 307", async () => {
    const { proxy } = await load("https://pizzadao.org");
    const r = await proxy(req("https://app.pizzadao.org/?ref=X"));
    expect(r.status).toBe(307);
    expect(redirectedTo(r)).toBe("https://pizzadao.org/start?ref=X");
  });
  it("a deep path is kept with its query", async () => {
    const { proxy } = await load("https://pizzadao.org");
    const r = await proxy(req("https://app.pizzadao.org/profile/abc?tab=vouches"));
    expect(r.status).toBe(307);
    expect(redirectedTo(r)).toBe("https://pizzadao.org/profile/abc?tab=vouches");
  });
  it("/api, /_next and /.well-known are never redirected", async () => {
    const { proxy } = await load("https://pizzadao.org");
    for (const p of ["/api/discord/interactions", "/api/followups/inbound?x=1", "/_next/static/a.js", "/.well-known/x"]) {
      expect(passed(await proxy(req("https://app.pizzadao.org" + p)))).toBe(true);
    }
  });
  it("a protocol-relative path cannot redirect off-site", async () => {
    const { proxy } = await load("https://pizzadao.org");
    const r = await proxy(req("https://app.pizzadao.org//evil.com/x"));
    expect(new URL(redirectedTo(r)!).origin).toBe("https://pizzadao.org");
  });
  it("is 308 once the permanent setting is on (production only)", async () => {
    loadSettings.mockResolvedValue(settingsWith({ "site.hostRedirectEnabled": true, "site.hostRedirectPermanent": true }));
    const { proxy } = await load("https://pizzadao.org");
    expect((await proxy(req("https://app.pizzadao.org/crew"))).status).toBe(308);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("SITE_HOST_REDIRECT_ENABLED", "true");
    expect((await proxy(req("https://app.pizzadao.org/crew"))).status).toBe(307);
  });
  it("other hosts are untouched", async () => {
    const { proxy } = await load("https://pizzadao.org");
    expect(passed(await proxy(req("https://pizzadao.org/crew")))).toBe(true);
    expect(passed(await proxy(req("https://onboarding-abc-pizza-dao.vercel.app/crew")))).toBe(true);
  });
});

describe("session bridge", () => {
  const signedIn = { discordId: "123456789012345678", username: "u", nick: "n", createdAt: Date.now() };
  const bridgeOn = () =>
    loadSettings.mockResolvedValue(settingsWith({ "site.hostRedirectEnabled": true, "site.sessionBridgeEnabled": true }));
  const withCookie = { cookie: "pizzadao_session=tok" };

  it("switch off: a signed-in member gets the plain redirect, no token", async () => {
    const { proxy, verifySession } = await load("https://pizzadao.org");
    verifySession.mockReturnValue(signedIn);
    const r = await proxy(req("https://app.pizzadao.org/crew", { headers: withCookie }));
    expect(redirectedTo(r)).toBe("https://pizzadao.org/crew");
    expect(r.headers.get("set-cookie")).toBeNull();
  });
  it("on: a signed-in member is handed to the transfer endpoint with a no-store 307 and a jti cookie", async () => {
    bridgeOn();
    const { proxy, verifySession } = await load("https://pizzadao.org");
    verifySession.mockReturnValue(signedIn);
    const r = await proxy(req("https://app.pizzadao.org/crew?x=1", { headers: withCookie }));
    const to = new URL(redirectedTo(r)!);
    expect(r.status).toBe(307);
    expect(to.origin + to.pathname).toBe("https://pizzadao.org/api/auth/session-transfer");
    expect(to.searchParams.get("next")).toBe("/crew?x=1");
    expect(to.searchParams.get("token")).toBeTruthy();
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toMatch(/pd_bridge=/);
    expect(cookie).toMatch(/Domain=pizzadao\.org/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
  });
  it("on: the root bridges to /start", async () => {
    bridgeOn();
    const { proxy, verifySession } = await load("https://pizzadao.org");
    verifySession.mockReturnValue(signedIn);
    const r = await proxy(req("https://app.pizzadao.org/", { headers: withCookie }));
    expect(new URL(redirectedTo(r)!).searchParams.get("next")).toBe("/start");
  });
  it("on: signed out, prefetches, non-GET and non-bridgeable paths get the plain redirect", async () => {
    bridgeOn();
    const { proxy, verifySession } = await load("https://pizzadao.org");
    verifySession.mockReturnValue(null);
    expect(redirectedTo(await proxy(req("https://app.pizzadao.org/crew")))).toBe("https://pizzadao.org/crew");
    verifySession.mockReturnValue(signedIn);
    const plain = async (url: string, init?: { headers?: Record<string, string>; method?: string }) => {
      const r = await proxy(req(url, init));
      expect(r.headers.get("set-cookie")).toBeNull();
      return redirectedTo(r);
    };
    expect(await plain("https://app.pizzadao.org/crew", { headers: { ...withCookie, "next-router-prefetch": "1" } })).toBe("https://pizzadao.org/crew");
    expect(await plain("https://app.pizzadao.org/crew", { headers: withCookie, method: "POST" })).toBe("https://pizzadao.org/crew");
    expect(await plain("https://app.pizzadao.org/login", { headers: withCookie })).toBe("https://pizzadao.org/login");
  });
  it("on: HEAD gets the plain redirect (no cookie overwrite)", async () => {
    bridgeOn();
    const { proxy, verifySession } = await load("https://pizzadao.org");
    verifySession.mockReturnValue(signedIn);
    const r = await proxy(req("https://app.pizzadao.org/crew", { headers: withCookie, method: "HEAD" }));
    expect(redirectedTo(r)).toBe("https://pizzadao.org/crew");
    expect(r.headers.get("set-cookie")).toBeNull();
  });
  it("on: nothing is minted when the redirect itself is off", async () => {
    loadSettings.mockResolvedValue(settingsWith({ "site.sessionBridgeEnabled": true }));
    const { proxy, verifySession } = await load("https://pizzadao.org");
    verifySession.mockReturnValue(signedIn);
    expect(passed(await proxy(req("https://app.pizzadao.org/crew", { headers: withCookie })))).toBe(true);
    expect(verifySession).not.toHaveBeenCalled();
  });
});
