import { describe, expect, it } from "vitest";
import { LEGACY_ASSET_PATHS, LEGACY_DASHBOARD_SECTIONS, legacyAssetRedirects, legacyDashboardRedirects } from "./legacy-paths";

describe("legacy dashboard prototype redirects", () => {
  const rules = legacyDashboardRedirects();

  it("redirects every section and its subpaths to / with a 308", () => {
    for (const section of LEGACY_DASHBOARD_SECTIONS) {
      expect(rules).toContainEqual({ source: `/dashboard/${section}`, destination: "/", permanent: true });
      expect(rules).toContainEqual({ source: `/dashboard/${section}/:path*`, destination: "/", permanent: true });
    }
    expect(rules.every((r) => r.permanent && r.destination === "/")).toBe(true);
  });

  it("covers the prototype's section list", () => {
    expect([...LEGACY_DASHBOARD_SECTIONS].sort()).toEqual(
      ["arcade", "bounties", "connections", "events", "family", "feed", "path", "profile", "recognition", "settings", "shop"],
    );
  });

  it("never matches the real dashboard (/dashboard exact or /dashboard/<member id>)", () => {
    const matches = (path: string) =>
      rules.some((r) => {
        const base = r.source.replace("/:path*", "");
        return path === base || (r.source.endsWith("/:path*") && path.startsWith(base + "/"));
      });
    expect(matches("/dashboard")).toBe(false);
    expect(matches("/dashboard/12345")).toBe(false);
    expect(matches("/dashboard/family/7")).toBe(true);
  });
});

describe("legacy asset redirects", () => {
  it("sends each old asset URL to an existing /marketing copy", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const rules = legacyAssetRedirects();
    expect(rules).toHaveLength(LEGACY_ASSET_PATHS.length);
    for (const r of rules) {
      expect(r.permanent).toBe(true);
      expect(r.destination).toBe(`/marketing${r.source}`);
      expect(fs.existsSync(path.join(process.cwd(), "public", r.destination))).toBe(true);
      expect(fs.existsSync(path.join(process.cwd(), "public", r.source))).toBe(false);
    }
  });
});
