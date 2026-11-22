// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.SESSION_SECRET ||= "test-secret";
  return { limit: vi.fn(), cfg: vi.fn(), create: vi.fn(), cancel: vi.fn() };
});
vi.mock("@/app/lib/rate-limit", () => ({ enforceRateLimit: mocks.limit }));
vi.mock("@/app/lib/db", () => ({ prisma: {} }));
vi.mock("@/app/lib/telegram/signin-settings", () => ({ signinConfig: () => mocks.cfg() }));
vi.mock("@/app/lib/telegram/signin-code", async (orig) => ({
  ...(await orig<typeof import("@/app/lib/telegram/signin-code")>()),
  createSigninRequest: (...a: unknown[]) => mocks.create(...a),
  cancelSignin: (...a: unknown[]) => mocks.cancel(...a),
}));
import { DELETE, GET, POST } from "./route";

const saved = { ...process.env };
const CODE = "A".repeat(43);
const url = "https://app.example/api/auth/telegram/start";
const post = (body: unknown = {}, headers: Record<string, string> = {}) =>
  POST(new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TELEGRAM_LOGIN_BOT_TOKEN = "123:abc";
  process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME = "pizzadao_login_bot";
  process.env.VERCEL_ENV = "production";
  mocks.limit.mockResolvedValue(null);
  mocks.cancel.mockResolvedValue(undefined);
  mocks.cfg.mockResolvedValue({ enabled: true, allowlist: [], ttlMinutes: 5 });
  mocks.create.mockResolvedValue({ code: CODE, cookieValue: `${CODE}.${"B".repeat(43)}`, matchNumber: 47, expiresAt: new Date(Date.now() + 300_000) });
});
afterEach(() => {
  process.env = { ...saved };
});

describe("telegram sign-in start", () => {
  it("makes a request: the t.me link, the number, and an httpOnly cookie scoped to the sign-in routes", async () => {
    const res = await post({ returnTo: "/profile/77" });
    const body = await res.json();
    expect(body.url).toBe(`https://t.me/pizzadao_login_bot?start=si_${CODE}`);
    expect(body.matchNumber).toBe(47);
    expect(body.expiresInSeconds).toBeGreaterThan(290);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ returnTo: "/profile/77", ttlMinutes: 5 }));
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("pd_tg_signin="))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/auth\/telegram/);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("is rate limited per IP before it does anything", async () => {
    mocks.limit.mockResolvedValue(new Response(null, { status: 429 }));
    expect((await post()).status).toBe(429);
    expect(mocks.limit).toHaveBeenCalledWith(expect.any(Request), "telegram-signin-start");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("404 while off, 503 on previews and when the bot is not configured", async () => {
    mocks.cfg.mockResolvedValue({ enabled: false, allowlist: [], ttlMinutes: 5 });
    expect((await post()).status).toBe(404);
    mocks.cfg.mockResolvedValue({ enabled: true, allowlist: [], ttlMinutes: 5 });
    process.env.VERCEL_ENV = "preview";
    expect((await post()).status).toBe(503);
    process.env.VERCEL_ENV = "production";
    delete process.env.TELEGRAM_LOGIN_BOT_TOKEN;
    expect((await post()).status).toBe(404);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses non-JSON and cross-origin writes", async () => {
    const plain = await POST(new Request(url, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" }));
    expect(plain.status).toBe(415);
    expect((await post({}, { origin: "https://evil.example", host: "app.example" })).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("GET says whether to show the button; a tester allowlist hides it unless forced", async () => {
    expect(await (await GET(new Request(url))).json()).toEqual({ enabled: true });
    mocks.cfg.mockResolvedValue({ enabled: true, allowlist: ["123456789012345678"], ttlMinutes: 5 });
    expect(await (await GET(new Request(url))).json()).toEqual({ enabled: false });
    expect(await (await GET(new Request(`${url}?forced=1`))).json()).toEqual({ enabled: true });
    mocks.cfg.mockResolvedValue({ enabled: false, allowlist: [], ttlMinutes: 5 });
    expect(await (await GET(new Request(`${url}?forced=1`))).json()).toEqual({ enabled: false });
  });

  it("Stop waiting drops this browser's request and clears the cookie", async () => {
    const cookie = `${CODE}.${"B".repeat(43)}`;
    const res = await DELETE(new Request(url, { method: "DELETE", headers: { "content-type": "application/json", cookie: `pd_tg_signin=${cookie}` } }));
    expect(res.status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith(cookie);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("pd_tg_signin=;") || c.includes("Max-Age=0"))).toBe(true);
  });
});
