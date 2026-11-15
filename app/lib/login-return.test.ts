import { describe, expect, it } from "vitest";
import { loggedInLanding, loginHrefFrom, loginPageHref, loginReturnPath } from "./login-return";

describe("loginHrefFrom (header / prompt Log in buttons)", () => {
  it("comes back to the current page", () => {
    expect(loginHrefFrom("/calls/live")).toBe("/login?returnTo=%2Fcalls%2Flive");
    expect(loginHrefFrom("/crew/abc?tab=1")).toBe("/login?returnTo=%2Fcrew%2Fabc%3Ftab%3D1");
  });
  it("is plain /login for home, the wizard, login itself and junk", () => {
    for (const p of ["/", "/start", "/login", "/api/me", "//evil.example", "", null, undefined]) expect(loginHrefFrom(p)).toBe("/login");
  });
});

describe("loggedInLanding (the tab that asked for a DM link)", () => {
  it("sends a linked member back to the page the login started from", () => {
    expect(loggedInLanding({ discordId: "1", memberId: "42" }, { returnTo: "/calls/live", wizardHome: "/start" })).toBe("/calls/live");
  });
  it("falls back to the dashboard, never to an outside or api target", () => {
    for (const bad of [undefined, "https://evil.example", "//evil.example", "/api/logout"]) {
      expect(loggedInLanding({ discordId: "1", memberId: "42" }, { returnTo: bad, wizardHome: "/start" })).toBe("/dashboard/42");
    }
  });
  it("sends an unlinked member to the wizard with their identity and return path", () => {
    const href = loggedInLanding({ discordId: "1", nick: "Nick" }, { returnTo: "/calls/live", wizardHome: "/start", resumeSignup: true });
    const u = new URL(href, "https://x.example");
    expect(u.pathname).toBe("/start");
    expect(Object.fromEntries(u.searchParams)).toEqual({ resumeSignup: "1", discordId: "1", discordJoined: "1", discordNick: "Nick", returnTo: "/calls/live" });
  });
});

describe("login return path", () => {
  it("preserves local destinations and query strings", () => {
    expect(loginReturnPath("/profile/42?tab=vouches#details")).toBe("/profile/42?tab=vouches#details");
    expect(loginReturnPath("/chats/new-york")).toBe("/chats/new-york");
  });

  it.each([undefined, "https://example.com", "//example.com", "/\\example.com", "/%2fexample.com", "/%5cexample.com", "/api/logout", "/login", "/join", "/%61pi/logout", "/../api/logout", "/bad%encoding", "/\nexample.com"])("rejects unsafe or looping destination %s", (value) => {
    expect(loginReturnPath(value)).toBeUndefined();
  });
});

describe("login page href", () => {
  it("carries a local returnTo through /login, with other params", () => {
    expect(loginPageHref("?lane=host&returnTo=%2Flanes%2Fhost%3Fpick%3D1")).toBe("/login?returnTo=%2Flanes%2Fhost%3Fpick%3D1");
    expect(loginPageHref("?returnTo=%2Fmissions", "onboarding=1")).toBe("/login?onboarding=1&returnTo=%2Fmissions");
  });

  it.each(["https://evil.example", "//evil.example", "/api/logout", "/join"])("drops an unsafe returnTo %s", (value) => {
    expect(loginPageHref(`?returnTo=${encodeURIComponent(value)}`)).toBe("/login");
    expect(loginPageHref(`?returnTo=${encodeURIComponent(value)}`, "onboarding=1")).toBe("/login?onboarding=1");
  });

  it("is plain /login without a returnTo", () => {
    expect(loginPageHref("")).toBe("/login");
  });
});
