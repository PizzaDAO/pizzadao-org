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
import { decodeOAuthState, encodeOAuthState, createPendingLogin } from "@/app/lib/oauth-proxy";
import { createSessionToken } from "@/app/lib/session";

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
function mockDiscord({ inGuild = true, scope = "identify", guildNick = "Nick" as string | null } = {}) {
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
      return inGuild ? jsonRes({ nick: guildNick, roles: [], user: { username: "user1", global_name: "Global Name" } }) : jsonRes({ message: "Unknown Member" }, 404);
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

describe("guild join flow (zucchini-21674)", () => {
  function cb(state: Parameters<typeof encodeOAuthState>[0]) {
    const encoded = encodeOAuthState({ ...state, nonce: "n1" });
    const url = `${ORIGIN}/api/discord/callback?code=c&state=${encodeURIComponent(encoded)}`;
    return callback(new Request(url, { headers: { cookie: "oauth_state=n1" } }));
  }

  it("default login requests only the identify scope", async () => {
    const res = await login(new Request(`${ORIGIN}/api/discord/login`));
    const auth = new URL(res.headers.get("location")!);
    expect(auth.searchParams.get("scope")).toBe("identify");
    expect(decodeOAuthState(auth.searchParams.get("state")!).join).toBeUndefined();
  });

  it("join=1 requests guilds.join explicitly and marks the state", async () => {
    const res = await login(new Request(`${ORIGIN}/api/discord/login?join=1&state=sess`));
    const auth = new URL(res.headers.get("location")!);
    expect(auth.searchParams.get("scope")).toBe("identify guilds.join");
    expect(auth.searchParams.get("prompt")).toBe("consent");
    const state = decodeOAuthState(auth.searchParams.get("state")!);
    expect(state.join).toBe(true);
    expect(state.sessionId).toBe("sess");
  });

  it("existing guild members are logged in without any join step or PUT", async () => {
    const calls = mockDiscord({ inGuild: true, scope: "identify" });
    const res = await cb({ sessionId: "" });
    expect(res.headers.get("location")).toBe(`${ORIGIN}/dashboard/42`);
    expect(calls.some((c) => c.startsWith("PUT "))).toBe(false);
  });

  it("non-members are sent to the explicit join step (no session yet)", async () => {
    mockFetchMemberByDiscordId.mockResolvedValue(null);
    const calls = mockDiscord({ inGuild: false, scope: "identify" });
    const res = await cb({ sessionId: "sess-9" });
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(`${ORIGIN}/api/discord/login`);
    expect(loc.searchParams.get("join")).toBe("1");
    expect(loc.searchParams.get("state")).toBe("sess-9");
    expect(cookieFrom(res, "pizzadao_session")).toBeUndefined();
    expect(calls.some((c) => c.startsWith("PUT "))).toBe(false);
  });

  it("join step keeps return_to for the preview proxy flow", async () => {
    mockDiscord({ inGuild: false, scope: "identify" });
    const returnTo = "https://onboarding-abc123xyz-pizza-dao.vercel.app";
    const res = await cb({ sessionId: "", return_to: returnTo });
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("join")).toBe("1");
    expect(loc.searchParams.get("return_to")).toBe(returnTo);
  });

  it("join step with guilds.join adds the new member to the guild (onboarding)", async () => {
    mockFetchMemberByDiscordId.mockResolvedValue(null);
    let joined = false;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      const method = init?.method ?? "GET";
      if (u.endsWith("/oauth2/token")) return jsonRes({ access_token: "at", scope: "identify guilds.join" });
      if (u.endsWith("/users/@me")) return jsonRes({ id: "u1", username: "user1" });
      if (method === "PUT") {
        expect(JSON.parse(String(init?.body))).toEqual({ access_token: "at" });
        joined = true;
        return { ok: true, status: 201, text: async (): Promise<string> => "" };
      }
      return joined ? jsonRes({ nick: "Fresh", roles: [] }) : jsonRes({ message: "Unknown Member" }, 404);
    }) as unknown as typeof fetch;

    const res = await cb({ sessionId: "sess-9", join: true });
    expect(joined).toBe(true);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/");
    expect(loc.searchParams.get("discordJoined")).toBe("1");
    expect(loc.searchParams.get("discordNick")).toBe("Fresh");
    expect(loc.searchParams.get("sessionId")).toBe("sess-9");
    expect(cookieFrom(res, "pizzadao_session")).toBe("mock-session-token");
  });

  it("does not loop if the join step returns without guilds.join", async () => {
    mockFetchMemberByDiscordId.mockResolvedValue(null);
    mockDiscord({ inGuild: false, scope: "identify" });
    const res = await cb({ sessionId: "", join: true });
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/");
    expect(loc.searchParams.get("discordJoined")).toBe("0");
  });
});

describe("cancelling the guilds.join screen (zucchini-21674 gap 1)", () => {
  process.env.SESSION_SECRET ||= "test-secret";
  const pending = () => createPendingLogin({ discordId: "u1", username: "user1", nick: "Nicky", nonce: "n1" });
  const cancel = (opts: { join?: boolean; cookie?: string; return_to?: string } = {}) => {
    const { join = true, cookie = `oauth_state=n1; oauth_pending=${pending()}`, return_to } = opts;
    const st = encodeOAuthState({ sessionId: "sess-9", nonce: "n1", join, return_to });
    return callback(new Request(`${ORIGIN}/api/discord/callback?error=access_denied&state=${encodeURIComponent(st)}`, { headers: { cookie } }));
  };

  it("sets a signed oauth_pending cookie (no tokens) on the join redirect", async () => {
    mockFetchMemberByDiscordId.mockResolvedValue(null);
    mockDiscord({ inGuild: false, scope: "identify" });
    const st = encodeOAuthState({ sessionId: "s", nonce: "n1" });
    const res = await callback(new Request(`${ORIGIN}/api/discord/callback?code=c&state=${encodeURIComponent(st)}`, { headers: { cookie: "oauth_state=n1" } }));
    const raw = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("oauth_pending=") && !c.startsWith("oauth_pending=;"))!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=lax/i);
    expect(raw).toMatch(/Max-Age=600/i);
    const payload = JSON.parse(Buffer.from(decodeURIComponent(raw.split("=")[1].split(";")[0]).split(".")[0], "base64url").toString());
    expect(Object.keys(payload).sort()).toEqual(["discordId", "exp", "nick", "nonce", "username"]);
    // bound to the join nonce, which also becomes the oauth_state cookie and the login ?nonce
    expect(payload.nonce).toBe(cookieFrom(res, "oauth_state"));
    expect(new URL(res.headers.get("location")!).searchParams.get("nonce")).toBe(payload.nonce);
  });

  it("logs the person in with discordJoined=0 and clears both cookies", async () => {
    mockFetchMemberByDiscordId.mockResolvedValue(null);
    const res = await cancel();
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/");
    expect(loc.searchParams.get("discordId")).toBe("u1");
    expect(loc.searchParams.get("discordJoined")).toBe("0");
    expect(loc.searchParams.get("discordNick")).toBe("Nicky");
    expect(loc.searchParams.get("sessionId")).toBe("sess-9");
    expect(cookieFrom(res, "pizzadao_session")).toBe("mock-session-token");
    expect(cookieFrom(res, "oauth_pending")).toBe("");
    expect(cookieFrom(res, "oauth_state")).toBe("");
  });

  it("an abandoned pending cookie cannot be used by a later unrelated join login", async () => {
    const stale = pending(); // user A, bound to nonce n1, abandoned
    const res = await login(new Request(`${ORIGIN}/api/discord/login?join=1`, { headers: { cookie: `oauth_pending=${stale}` } }));
    const fresh = cookieFrom(res, "oauth_state")!;
    expect(fresh).not.toBe("n1");
    expect(cookieFrom(res, "oauth_pending")).toBe(""); // cleared
    const st = encodeOAuthState({ sessionId: "", nonce: fresh, join: true });
    const out = await callback(new Request(`${ORIGIN}/api/discord/callback?error=access_denied&state=${encodeURIComponent(st)}`, { headers: { cookie: `oauth_state=${fresh}; oauth_pending=${stale}` } }));
    expect(out.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(cookieFrom(out, "pizzadao_session")).toBeUndefined();
  });

  it("login?join=1 reuses the offered nonce only when the pending cookie is bound to it", async () => {
    const ok = await login(new Request(`${ORIGIN}/api/discord/login?join=1&nonce=n1`, { headers: { cookie: `oauth_pending=${pending()}` } }));
    expect(cookieFrom(ok, "oauth_state")).toBe("n1");
    expect(decodeOAuthState(new URL(ok.headers.get("location")!).searchParams.get("state")!).nonce).toBe("n1");
    const bad = await login(new Request(`${ORIGIN}/api/discord/login?join=1&nonce=evil`, { headers: { cookie: `oauth_pending=${pending()}` } }));
    expect(cookieFrom(bad, "oauth_state")).not.toBe("evil");
  });

  it("a non-join login start clears oauth_pending", async () => {
    const res = await login(new Request(`${ORIGIN}/api/discord/login`, { headers: { cookie: `oauth_pending=${pending()}` } }));
    expect(cookieFrom(res, "oauth_pending")).toBe("");
  });

  it("clears oauth_pending on error fallbacks and the nonce-failure 400", async () => {
    const bare = await cancel({ cookie: "oauth_state=n1" });
    expect(cookieFrom(bare, "oauth_pending")).toBe("");
    const st = encodeOAuthState({ sessionId: "", nonce: "n1" });
    const bad = await callback(new Request(`${ORIGIN}/api/discord/callback?code=c&state=${encodeURIComponent(st)}`, { headers: { cookie: `oauth_pending=${pending()}` } }));
    expect(bad.status).toBe(400);
    expect(cookieFrom(bad, "oauth_pending")).toBe("");
  });

  it("only access_denied is honored; other errors redirect as before", async () => {
    const st = encodeOAuthState({ sessionId: "s", nonce: "n1", join: true });
    for (const err of ["server_error", "invalid_request"]) {
      const res = await callback(new Request(`${ORIGIN}/api/discord/callback?error=${err}&state=${encodeURIComponent(st)}`, { headers: { cookie: `oauth_state=n1; oauth_pending=${pending()}` } }));
      expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
      expect(cookieFrom(res, "pizzadao_session")).toBeUndefined();
    }
  });

  it("does not log in without a valid pending cookie", async () => {
    for (const cookie of ["oauth_state=n1", "oauth_state=n1; oauth_pending=garbage.sig", `oauth_state=n1; oauth_pending=${pending()}x`]) {
      const res = await cancel({ cookie });
      expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
      expect(cookieFrom(res, "pizzadao_session")).toBeUndefined();
    }
  });

  it("does not log in when the oauth_state nonce does not match", async () => {
    const res = await cancel({ cookie: `oauth_state=other; oauth_pending=${pending()}` });
    expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(cookieFrom(res, "pizzadao_session")).toBeUndefined();
  });

  it("ignores the pending cookie when cancelling the first (non-join) step", async () => {
    const res = await cancel({ join: false });
    expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(cookieFrom(res, "pizzadao_session")).toBeUndefined();
  });

  it("proxy flow returns a transfer token instead of a session cookie", async () => {
    const returnTo = "https://onboarding-abc123xyz-pizza-dao.vercel.app";
    const res = await cancel({ return_to: returnTo });
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin).toBe(returnTo);
    expect(loc.pathname).toBe("/api/auth/session-transfer");
    expect(loc.searchParams.get("token")).toBeTruthy();
    expect(cookieFrom(res, "pizzadao_session")).toBeUndefined();
  });
});

describe("session nick ignores the Pizza Trainee placeholder (anchovy-52918)", () => {
  const cb = () =>
    callback(new Request(`${ORIGIN}/api/discord/callback?code=c&state=${encodeURIComponent(encodeOAuthState({ sessionId: "", nonce: "n1" }))}`, { headers: { cookie: "oauth_state=n1" } }));

  it("falls back to the global name when the guild nick is Pizza Trainee", async () => {
    mockDiscord({ guildNick: "Pizza Trainee" });
    await cb();
    expect(vi.mocked(createSessionToken).mock.calls[0][0]).toMatchObject({ nick: "Global Name" });
  });

  it("keeps a real guild nick", async () => {
    mockDiscord({ guildNick: "Tony" });
    await cb();
    expect(vi.mocked(createSessionToken).mock.calls[0][0]).toMatchObject({ nick: "Tony" });
  });
});
