// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bridgeCookieMatches, bridgeCookieOptions, bridgeTokenHash, isPrefetchLike, mintBridge } from "./session-bridge";
import { verifyTransferToken } from "./oauth-proxy";

const SITE = "https://pizzadao.org";
const session = { discordId: "123456789012345678", username: "u", nick: "n", createdAt: Date.now() };

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("mintBridge", () => {
  it("builds a transfer URL on the main site with a signed, short-lived token bound to its origin and jti", () => {
    const b = mintBridge(session, "/crew?x=1", SITE)!;
    const url = new URL(b.url);
    expect(url.origin).toBe(SITE);
    expect(url.pathname).toBe("/api/auth/session-transfer");
    expect(url.searchParams.get("next")).toBe("/crew?x=1");
    const payload = verifyTransferToken(url.searchParams.get("token")!)!;
    expect(payload.discordId).toBe(session.discordId);
    expect(payload.origin).toBe(SITE);
    expect(payload.jti).toBe(b.jti);
    expect(payload.exp - Date.now()).toBeLessThanOrEqual(60_000);
  });
  it("uses a fresh jti every time", () => {
    expect(mintBridge(session, "/crew", SITE)!.jti).not.toBe(mintBridge(session, "/crew", SITE)!.jti);
  });
  it("hands over nothing for a path the app would not honour as a return path", () => {
    for (const p of ["/login", "/join?ref=1", "/api/x", "//evil.com", "https://evil.com", "relative"]) {
      expect(mintBridge(session, p, SITE)).toBeNull();
    }
  });
  it("hands over nothing without a Discord id", () => {
    expect(mintBridge({ ...session, discordId: "" }, "/crew", SITE)).toBeNull();
  });
});

describe("bridge cookie", () => {
  it("is httpOnly, secure, path-scoped to the transfer endpoint and shared with the apex via Domain", () => {
    expect(bridgeCookieOptions(SITE)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/auth/session-transfer",
      domain: "pizzadao.org",
    });
  });
  it("matches only the exact jti", () => {
    expect(bridgeCookieMatches("abc", "abc")).toBe(true);
    expect(bridgeCookieMatches("abc", "abd")).toBe(false);
    expect(bridgeCookieMatches("abc", "abcd")).toBe(false);
    expect(bridgeCookieMatches(undefined, "abc")).toBe(false);
    expect(bridgeCookieMatches("abc", undefined)).toBe(false);
  });
  it("hashes the jti for the spent-token record", () => {
    expect(bridgeTokenHash("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(bridgeTokenHash("abc")).not.toBe("abc");
  });
});

describe("isPrefetchLike", () => {
  it("spots router prefetches and RSC fetches", () => {
    expect(isPrefetchLike(new Headers({ "next-router-prefetch": "1" }))).toBe(true);
    expect(isPrefetchLike(new Headers({ rsc: "1" }))).toBe(true);
    expect(isPrefetchLike(new Headers({ purpose: "prefetch" }))).toBe(true);
    expect(isPrefetchLike(new Headers({ "sec-purpose": "prefetch;prerender" }))).toBe(true);
    expect(isPrefetchLike(new Headers({ accept: "text/html" }))).toBe(false);
  });
});
