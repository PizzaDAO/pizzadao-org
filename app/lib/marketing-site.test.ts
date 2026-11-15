// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { MARKETING_PATHS, MARKETING_SITEMAP_PATHS, WIZARD_QUERY_KEYS, isMarketingPath, wizardParamRedirects, marketingHomeAtRoot, marketingIndexable, marketingRobots, speedInsightsEnabled } from "./marketing-site";

afterEach(() => vi.unstubAllEnvs());

describe("speed insights switch", () => {
  it("is off by default and on for the usual on-words", () => {
    expect(speedInsightsEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_SPEED_INSIGHTS_ENABLED", " True ");
    expect(speedInsightsEnabled()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_SPEED_INSIGHTS_ENABLED", "0");
    expect(speedInsightsEnabled()).toBe(false);
  });
});

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

  it("sends / with a wizard query key to /start only while the home page is at /", () => {
    expect(wizardParamRedirects()).toEqual([]);
    vi.stubEnv("NEXT_PUBLIC_MARKETING_HOME_AT_ROOT", "1");
    const rules = wizardParamRedirects();
    expect(rules.map((r) => r.has[0].key)).toEqual([...WIZARD_QUERY_KEYS]);
    for (const r of rules) expect(r).toMatchObject({ source: "/", destination: "/start", permanent: false });
    expect(WIZARD_QUERY_KEYS).toContain("discordId");
  });
});
