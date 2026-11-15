import { describe, expect, it } from "vitest";
import { loginPageHref, loginReturnPath } from "./login-return";

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
