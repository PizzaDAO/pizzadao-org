import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db");
vi.mock("@/app/lib/sync-roles-on-login", () => ({ syncRolesOnLogin: vi.fn().mockResolvedValue(undefined) }));
const mockFetchMemberByDiscordId = vi.fn();
vi.mock("@/app/lib/sheets/member-repository", () => ({
  fetchMemberByDiscordId: (...a: unknown[]) => mockFetchMemberByDiscordId(...a),
}));
vi.mock("@/app/lib/session", () => ({
  createSessionToken: vi.fn().mockReturnValue("tok"),
  getSessionCookieOptions: vi.fn().mockReturnValue({ path: "/" }),
  COOKIE_NAME: "pizzadao_session",
}));
const mockDecode = vi.fn();
vi.mock("@/app/lib/oauth-proxy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/oauth-proxy")>();
  return { ...actual, decodeOAuthState: (s: string) => mockDecode(s) };
});

function mockDiscord() {
  const f = vi.fn();
  f.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "a", token_type: "Bearer", scope: "identify", expires_in: 1 }) });
  f.mockResolvedValueOnce({ ok: true, json: async () => ({ id: "d1", username: "u", global_name: "U" }) });
  f.mockResolvedValueOnce({ ok: true, json: async () => ({ nick: null, user: { global_name: "U", username: "u" } }) });
  global.fetch = f;
}

async function login(next: string | undefined) {
  mockDecode.mockReturnValue({ sessionId: "", nonce: "n", ...(next ? { next } : {}) });
  mockDiscord();
  mockFetchMemberByDiscordId.mockResolvedValueOnce({ memberId: "42", name: "U" });
  const { GET } = await import("./route");
  const res = await GET(new Request("http://localhost:3000/api/discord/callback?code=c&state=s", { headers: { cookie: "oauth_state=n" } }));
  return new URL(res.headers.get("location")!);
}

describe("Discord OAuth callback: next", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DISCORD_CLIENT_ID = "x";
    process.env.DISCORD_CLIENT_SECRET = "x";
    process.env.DISCORD_REDIRECT_URI = "http://localhost:3000/api/discord/callback";
    process.env.DISCORD_GUILD_ID = "g";
    process.env.DISCORD_BOT_TOKEN = "b";
    process.env.SESSION_SECRET = "test-secret-at-least-32-chars-long!!";
  });

  it("lands an existing member on a validated local next path", async () => {
    const u = await login("/missions#mission-7");
    expect(u.pathname + u.hash).toBe("/missions#mission-7");
  });

  it("defaults to the dashboard without next", async () => {
    expect((await login(undefined)).pathname).toBe("/dashboard/42");
  });

  it("rejects external and api targets", async () => {
    for (const bad of ["https://evil.example/x", "//evil.example", "/api/logout", "/login"]) {
      const u = await login(bad);
      expect(u.origin).toBe("http://localhost:3000");
      expect(u.pathname).toBe("/dashboard/42");
    }
  });
});
