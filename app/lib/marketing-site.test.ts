// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { MARKETING_PATHS, MARKETING_SITEMAP_PATHS, isMarketingPath, marketingHomeAtRoot, marketingIndexable, marketingRobots } from "./marketing-site";

afterEach(() => vi.unstubAllEnvs());

describe("marketing switches", () => {
  it("are off by default: noindex, and the wizard keeps /", () => {
    expect(marketingIndexable()).toBe(false);
    expect(marketingHomeAtRoot()).toBe(false);
    expect(marketingRobots()).toEqual({ index: false, follow: false });
    expect(isMarketingPath("/")).toBe(false);
  });

  it("indexable drops the noindex tag", () => {
    vi.stubEnv("NEXT_PUBLIC_MARKETING_INDEXABLE", "1");
    expect(marketingRobots()).toEqual({ index: true, follow: true });
  });

  it("home at root makes / a marketing path", () => {
    vi.stubEnv("NEXT_PUBLIC_MARKETING_HOME_AT_ROOT", "1");
    expect(isMarketingPath("/")).toBe(true);
  });

  it("only exact marketing routes (and their children) count, never app routes", () => {
    for (const p of MARKETING_PATHS) expect(isMarketingPath(p)).toBe(true);
    for (const p of ["/join", "/login", "/articles", "/get-your-mafia-name", "/dashboard/abc", "/start", "/aboutus", "/crew/about"]) {
      expect(isMarketingPath(p), p).toBe(false);
    }
    expect(isMarketingPath(null)).toBe(false);
  });

  it("the sitemap list is a subset of the marketing routes and leaves out /home", () => {
    for (const p of MARKETING_SITEMAP_PATHS) expect(MARKETING_PATHS).toContain(p);
    expect(MARKETING_SITEMAP_PATHS).not.toContain("/home");
  });
});
