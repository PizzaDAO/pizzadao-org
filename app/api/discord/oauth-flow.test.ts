// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/sync-roles-on-login", () => ({
  syncRolesOnLogin: vi.fn().mockResolvedValue(undefined),
}));
const mockFetchMemberByDiscordId = vi.fn();
vi.mock("@/app/lib/sheets/member-repository", () => ({
  fetchMemberByDiscordId: (...a: unknown[]) => mockFetchMemberByDiscordId(...a),
}));
vi.mock("@/app/lib/session", () => ({
  createSessionToken: vi.fn().mockReturnValue("mock-session-token"),
  getSessionCookieOptions: vi.fn().mockReturnValue({ httpOnly: true, secure: false, sameSite: "lax", path: "/" }),
  COOKIE_NAME: "pizzadao_session",
}));

import { GET as login } from "./login/route";
import { GET as callback } from "./callback/route";
import { decodeOAuthState, encodeOAuthState } from "@/app/lib/oauth-proxy";

const ORIGIN = "https://app.pizzadao.org";

function cookieFrom(res: Response, name: string): string | undefined {
  const all = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
  for (const c of all) {
    const m = c.match(new RegExp(`(?:^|,\\s*)${name}=([^;]*)`));
    if (m) return decodeURIComponent(m[1]);
  }
  return undefined;
}

function jsonRes(body: unknown, status = 200): { ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> } {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

/** Discord happy path: token, /users/@me, guild member lookup(s), optional PUT. */
function mockDiscord({ inGuild = true, scope = "identify" } = {}) {
  const calls: string[] = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${u}`);
    if (u.endsWith("/oauth2/token")) {
      return jsonRes({ access_token: "at", token_type: "Bearer", scope, expires_in: 1 });
    }
    if (u.endsWith("/users/@me")) return jsonRes({ id: "u1", username: "user1" });
    if (u.includes("/guilds/") && method === "PUT") return { ok: true, status: 201, text: async (): Promise<string> => "" };
    if (u.includes("/guilds/")) {
      return inGuild ? jsonRes({ nick: "Nick", roles: [], user: { username: "user1" } }) : jsonRes({ message: "Unknown Member" }, 404);
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as unknown as typeof fetch;
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  process.env.DISCORD_CLIENT_ID = "cid";
  process.env.DISCORD_CLIENT_SECRET = "csecret";
  process.env.DISCORD_REDIRECT_URI = `${ORIGIN}/api/discord/callback`;
  process.env.DISCORD_GUILD_ID = "guild";
  process.env.DISCORD_BOT_TOKEN = "bot";
  process.env.SESSION_SECRET = "test-secret-at-least-32-chars-long!!";
  mockFetchMemberByDiscordId.mockResolvedValue({ memberId: "42", name: "User" });
});

describe("/api/discord/login oauth_state", () => {
  it("sets an httpOnly oauth_state cookie whose value is embedded in state", async () => {
    const res = await login(new Request(`${ORIGIN}/api/discord/login?state=sess-1`));
    expect(res.status).toBe(307);
    const nonce = cookieFrom(res, "oauth_state");
    expect(nonce).toBeTruthy();

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Max-Age=600/);

    const auth = new URL(res.headers.get("location")!);
    const state = decodeOAuthState(auth.searchParams.get("state")!);
    expect(state.sessionId).toBe("sess-1");
    expect(state.nonce).toBe(nonce);
  });

  it("keeps return_to in state for the preview proxy flow", async () => {
    const returnTo = "https://onboarding-abc123xyz-pizza-dao.vercel.app";
    const res = await login(new Request(`${ORIGIN}/api/discord/login?return_to=${encodeURIComponent(returnTo)}`));
    const auth = new URL(res.headers.get("location")!);
    const state = decodeOAuthState(auth.searchParams.get("state")!);
    expect(state.return_to).toBe(returnTo);
    expect(state.nonce).toBe(cookieFrom(res, "oauth_state"));
  });

  it("rejects a return_to outside the allowlist", async () => {
    const res = await login(new Request(`${ORIGIN}/api/discord/login?return_to=${encodeURIComponent("https://evil.vercel.app")}`));
    expect(res.status).toBe(400);
  });

  it("hops to the callback host so the cookie lands on the right origin", async () => {
    const res = await login(new Request("https://onboarding-pizza-dao.vercel.app/api/discord/login?state=s"));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin).toBe(ORIGIN);
    expect(loc.pathname).toBe("/api/discord/login");
    expect(loc.searchParams.get("state")).toBe("s");
    expect(cookieFrom(res, "oauth_state")).toBeUndefined();
  });
});

describe("/api/discord/callback oauth_state verification", () => {
  function cb(state: string, cookie?: string) {
    const url = `${ORIGIN}/api/discord/callback?code=c&state=${encodeURIComponent(state)}`;
    return callback(new Request(url, cookie ? { headers: { cookie } } : undefined));
  }

  it("rejects a callback without the oauth_state cookie (login CSRF)", async () => {
    const calls = mockDiscord();
    const res = await cb(encodeOAuthState({ sessionId: "", nonce: "n1" }));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0); // never exchanged the attacker's code
  });

  it("rejects a mismatched nonce", async () => {
    mockDiscord();
    const res = await cb(encodeOAuthState({ sessionId: "", nonce: "n1" }), "oauth_state=n2");
    expect(res.status).toBe(400);
  });

  it("rejects a legacy state with no nonce", async () => {
    mockDiscord();
    const res = await cb("plain-session", "oauth_state=n1");
    expect(res.status).toBe(400);
  });

  it("accepts a matching nonce, sets the session and clears the nonce cookie", async () => {
    mockDiscord();
    const res = await cb(encodeOAuthState({ sessionId: "", nonce: "n1" }), "oauth_state=n1");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/dashboard/42`);
    expect(cookieFrom(res, "pizzadao_session")).toBe("mock-session-token");
    const cleared = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("oauth_state="));
    expect(cleared).toMatch(/Max-Age=0/);
  });

  it("proxy flow: matching nonce redirects to the preview's session-transfer", async () => {
    mockDiscord();
    const returnTo = "https://onboarding-abc123xyz-pizza-dao.vercel.app";
    const res = await cb(encodeOAuthState({ sessionId: "", return_to: returnTo, nonce: "n1" }), "oauth_state=n1");
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin).toBe(returnTo);
    expect(loc.pathname).toBe("/api/auth/session-transfer");
    expect(loc.searchParams.get("token")).toBeTruthy();
  });
});
