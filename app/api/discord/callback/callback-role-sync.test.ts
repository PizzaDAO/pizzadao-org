import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the sync-roles-on-login module BEFORE importing the route
const mockSyncRolesOnLogin = vi.fn().mockResolvedValue(undefined);
vi.mock("@/app/lib/sync-roles-on-login", () => ({
  syncRolesOnLogin: mockSyncRolesOnLogin,
}));

// Mock the session module
vi.mock("@/app/lib/session", () => ({
  createSessionToken: vi.fn().mockReturnValue("mock-session-token"),
  getSessionCookieOptions: vi.fn().mockReturnValue({
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 2592000,
  }),
  COOKIE_NAME: "pizzadao_session",
}));

// Mock the oauth-proxy module
vi.mock("@/app/lib/oauth-proxy", () => ({
  decodeOAuthState: vi.fn().mockReturnValue({ sessionId: "", return_to: "" }),
  validateReturnTo: vi.fn().mockReturnValue(false),
  createTransferToken: vi.fn().mockReturnValue("mock-transfer-token"),
}));

// We need to mock the fetch calls that the callback route makes internally
// (exchangeCodeForToken, fetchDiscordMe, addUserToGuild, fetchGuildMember, checkExistingMember)
// Since these are internal to the route module, we mock global.fetch

describe("Discord callback route - role sync integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set env vars
    process.env.DISCORD_CLIENT_ID = "test-client-id";
    process.env.DISCORD_CLIENT_SECRET = "test-client-secret";
    process.env.DISCORD_REDIRECT_URI = "http://localhost:3000/api/discord/callback";
    process.env.DISCORD_GUILD_ID = "test-guild-id";
    process.env.DISCORD_BOT_TOKEN = "test-bot-token";
    process.env.SESSION_SECRET = "test-secret-at-least-32-chars-long!!";
  });

  it("syncRolesOnLogin is called after successful login with existing member", async () => {
    // Set up fetch mock to handle the various API calls in sequence
    const fetchMock = vi.fn();

    // 1. exchangeCodeForToken - POST to Discord OAuth
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "mock-access-token",
        token_type: "Bearer",
        scope: "identify guilds.join",
        expires_in: 604800,
      }),
    });

    // 2. fetchDiscordMe - GET /users/@me
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "discord-123",
        username: "testuser",
        global_name: "Test User",
      }),
    });

    // 3. addUserToGuild - PUT to guild members
    fetchMock.mockResolvedValueOnce({
      status: 204,
      ok: true,
    });

    // 4. fetchGuildMember - GET guild member
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        nick: "TestNick",
        user: { global_name: "Test User", username: "testuser" },
      }),
    });

    // 5. checkExistingMember - GET /api/member-lookup
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        memberId: "42",
        name: "Test User",
      }),
    });

    global.fetch = fetchMock;

    // Dynamically import the route handler (after mocks are set up)
    const { GET } = await import("./route");

    const url = "http://localhost:3000/api/discord/callback?code=test-code&state=test-state";
    const req = new Request(url);
    const response = await GET(req);

    // The response should be a redirect (302)
    expect(response.status).toBe(307);

    // syncRolesOnLogin should have been called with the user's info
    expect(mockSyncRolesOnLogin).toHaveBeenCalledTimes(1);
    expect(mockSyncRolesOnLogin).toHaveBeenCalledWith(
      "http://localhost:3000",
      "discord-123",
      "42",
      "Test User",
    );
  });

  it("syncRolesOnLogin is called for new users (no existing member)", async () => {
    const fetchMock = vi.fn();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "mock-access-token",
        token_type: "Bearer",
        scope: "identify guilds.join",
        expires_in: 604800,
      }),
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "discord-456",
        username: "newuser",
        global_name: "New User",
      }),
    });

    fetchMock.mockResolvedValueOnce({
      status: 204,
      ok: true,
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        nick: null,
        user: { global_name: "New User", username: "newuser" },
      }),
    });

    // No existing member
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    });

    global.fetch = fetchMock;

    const { GET } = await import("./route");

    const url = "http://localhost:3000/api/discord/callback?code=test-code&state=test-state";
    const req = new Request(url);
    const response = await GET(req);

    expect(response.status).toBe(307);

    // Even for new users, sync is called (with undefined memberId)
    expect(mockSyncRolesOnLogin).toHaveBeenCalledTimes(1);
    expect(mockSyncRolesOnLogin).toHaveBeenCalledWith(
      "http://localhost:3000",
      "discord-456",
      undefined,
      "New User",
    );
  });

  it("login succeeds even if syncRolesOnLogin rejects", async () => {
    // Make the sync function reject
    mockSyncRolesOnLogin.mockRejectedValueOnce(new Error("Sync exploded"));

    const fetchMock = vi.fn();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "mock-access-token",
        token_type: "Bearer",
        scope: "identify guilds.join",
        expires_in: 604800,
      }),
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "discord-789",
        username: "erroruser",
      }),
    });

    fetchMock.mockResolvedValueOnce({
      status: 204,
      ok: true,
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        nick: "ErrorNick",
        user: { username: "erroruser" },
      }),
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        memberId: "99",
        name: "Error User",
      }),
    });

    global.fetch = fetchMock;

    const { GET } = await import("./route");

    const url = "http://localhost:3000/api/discord/callback?code=test-code&state=test-state";
    const req = new Request(url);
    const response = await GET(req);

    // Login should still succeed (redirect)
    expect(response.status).toBe(307);
  });
});
