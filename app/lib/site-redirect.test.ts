// @vitest-environment node
import { describe, it, expect } from "vitest";
import { hostRedirectTarget, isExcludedFromHostRedirect, mappedPath, onLegacyHost } from "./site-redirect";
import { hstsHeaderValue } from "./hsts";

const APEX = "https://pizzadao.org";
const LEGACY = "https://app.pizzadao.org";

describe("onLegacyHost", () => {
  it("is true only on the old host with an apex site origin", () => {
    expect(onLegacyHost("app.pizzadao.org", APEX)).toBe(true);
    expect(onLegacyHost("APP.pizzadao.org:443", APEX)).toBe(true);
  });
  it("never fires on a build that still has the old SITE_URL (or an unparsable one)", () => {
    expect(onLegacyHost("app.pizzadao.org", LEGACY)).toBe(false);
    expect(onLegacyHost("app.pizzadao.org", "not a url")).toBe(false);
  });
  it("never fires on other hosts", () => {
    expect(onLegacyHost("pizzadao.org", APEX)).toBe(false);
    expect(onLegacyHost("onboarding-abc-pizza-dao.vercel.app", APEX)).toBe(false);
    expect(onLegacyHost("evil.app.pizzadao.org", APEX)).toBe(false);
    expect(onLegacyHost(null, APEX)).toBe(false);
  });
});

describe("isExcludedFromHostRedirect", () => {
  it("keeps api, _next, _vercel and .well-known on the old host", () => {
    for (const p of ["/api", "/api/discord/interactions", "/api/followups/inbound", "/_next/static/x.js", "/_vercel/insights/script.js", "/.well-known/apple-app-site-association"]) {
      expect(isExcludedFromHostRedirect(p)).toBe(true);
    }
  });
  it("redirects page paths, including look-alikes", () => {
    for (const p of ["/", "/crew", "/apiary", "/api-docs", "/_nextfoo", "/profile/1"]) {
      expect(isExcludedFromHostRedirect(p)).toBe(false);
    }
  });
});

describe("hostRedirectTarget", () => {
  it("sends / to /start and keeps the query", () => {
    expect(hostRedirectTarget("/", "?ref=X", APEX)).toBe("https://pizzadao.org/start?ref=X");
    expect(hostRedirectTarget("/", "", APEX)).toBe("https://pizzadao.org/start");
  });
  it("is path for path with the query string", () => {
    expect(hostRedirectTarget("/crew", "", APEX)).toBe("https://pizzadao.org/crew");
    expect(hostRedirectTarget("/profile/abc%20d", "?a=1&b=%2F", APEX)).toBe("https://pizzadao.org/profile/abc%20d?a=1&b=%2F");
  });
  it("cannot be turned into an open redirect by a leading double slash or backslash", () => {
    for (const p of ["//evil.com", "//evil.com/x", "/\\evil.com", "///evil.com"]) {
      const t = hostRedirectTarget(p, "", APEX);
      expect(t).not.toBeNull();
      expect(new URL(t!).origin).toBe(APEX);
    }
    expect(mappedPath("//evil.com", "")).toBe("/evil.com");
  });
  it("returns null for an unusable site url", () => {
    expect(hostRedirectTarget("/crew", "", "nope")).toBeNull();
  });
});

describe("hstsHeaderValue", () => {
  it("drops includeSubDomains on the apex", () => {
    expect(hstsHeaderValue("https://pizzadao.org")).toBe("max-age=63072000");
  });
  it("keeps it on a subdomain, and on anything unparsable", () => {
    expect(hstsHeaderValue("https://app.pizzadao.org")).toBe("max-age=63072000; includeSubDomains");
    expect(hstsHeaderValue("oops")).toBe("max-age=63072000; includeSubDomains");
  });
});
