import { describe, expect, it } from "vitest";
import { loginReturnPath } from "./login-return";

describe("login return path", () => {
  it("preserves local destinations and query strings", () => {
    expect(loginReturnPath("/profile/42?tab=vouches#details")).toBe("/profile/42?tab=vouches#details");
    expect(loginReturnPath("/chats/new-york")).toBe("/chats/new-york");
  });

  it.each([undefined, "https://example.com", "//example.com", "/\\example.com", "/%2fexample.com", "/%5cexample.com", "/api/logout", "/login", "/join", "/%61pi/logout", "/../api/logout", "/bad%encoding", "/\nexample.com"])("rejects unsafe or looping destination %s", (value) => {
    expect(loginReturnPath(value)).toBeUndefined();
  });
});
