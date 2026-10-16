// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/magic-login", () => ({ verifyMagicToken: vi.fn() }));
vi.mock("@/app/lib/session", () => ({ createSessionToken: vi.fn(() => "test-session"), getSessionCookieOptions: vi.fn(() => ({ httpOnly: true, path: "/", sameSite: "lax" })), COOKIE_NAME: "pizzadao_session" }));
vi.mock("@/app/lib/sync-roles-on-login", () => ({ syncRolesOnLogin: vi.fn(async () => {}) }));
vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberByDiscordId: vi.fn() }));
import { GET } from "./route";
import { verifyMagicToken } from "@/app/lib/magic-login";
import { fetchMemberByDiscordId } from "@/app/lib/sheets/member-repository";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyMagicToken).mockResolvedValue({ valid: true, discordId: "123", username: "test", nick: "Test Member" });
  vi.mocked(fetchMemberByDiscordId).mockResolvedValue({ memberId: "42", name: "Test Member" });
});
const request = (query: string) => new Request(`https://app.example/api/auth/magic-login?${query}`);

describe("Discord DM login callback", () => {
  it("creates a session and sends an existing member to their requested local page", async () => {
    const response = await GET(request("token=test&returnTo=%2Fprofile%2F77"));
    expect(response.headers.get("location")).toBe("https://app.example/profile/77");
    expect(response.headers.get("set-cookie")).toContain("pizzadao_session=test-session");
  });
  it("rejects external return destinations and falls back to the member dashboard", async () => {
    const response = await GET(request("token=test&returnTo=https%3A%2F%2Fevil.example"));
    expect(response.headers.get("location")).toBe("https://app.example/dashboard/42");
  });
  it("resumes pending onboarding instead of discarding a completed form", async () => {
    const response = await GET(request("token=test&onboarding=1"));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/");
    expect(location.searchParams.get("discordId")).toBe("123");
    expect(location.searchParams.get("discordJoined")).toBe("1");
    expect(location.searchParams.get("discordNick")).toBe("Test Member");
  });
  it("binds recovered data to a verified session and requests explicit review", async () => {
    vi.mocked(fetchMemberByDiscordId).mockResolvedValue(null);
    vi.mocked(verifyMagicToken).mockResolvedValue({ valid: true, discordId: "123", username: "test", nick: null, tokenHash: "a".repeat(64), draft: { mafiaName: "Test", city: "Paris", sessionId: "test-session" } });
    const response = await GET(request("token=test"));
    expect(response.headers.get("location")).toContain("resumeSignup=1");
    expect(response.headers.get("set-cookie")).toContain("pd_signup_draft=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });
  it("does not apply a signup draft to an existing profile", async () => {
    vi.mocked(verifyMagicToken).mockResolvedValue({ valid: true, discordId: "123", username: "test", nick: null, tokenHash: "a".repeat(64), draft: { mafiaName: "Changed", city: "Paris", sessionId: "test-session" } });
    const response = await GET(request("token=test&onboarding=1"));
    expect(response.headers.get("location")).toBe("https://app.example/dashboard/42");
    expect(response.headers.get("set-cookie")).not.toContain("pd_signup_draft");
  });
  it("sends unlinked members to the onboarding/claim flow", async () => {
    vi.mocked(fetchMemberByDiscordId).mockResolvedValue(null);
    const response = await GET(request("token=test"));
    expect(response.headers.get("location")).toContain("/?discordId=123");
  });
  it.each(["invalid", "expired", "used"] as const)("routes %s tokens back to the single login page", async reason => {
    vi.mocked(verifyMagicToken).mockResolvedValue({ valid: false, reason });
    const response = await GET(request("token=test"));
    expect(response.headers.get("location")).toMatch(/^https:\/\/app.example\/login\?loginError=/);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("does not verify or create a session when the token is missing", async () => {
    const response = await GET(request(""));
    expect(response.headers.get("location")).toBe("https://app.example/login?loginError=missing_token");
    expect(verifyMagicToken).not.toHaveBeenCalled();
  });
});
