// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildPublicCatalog } from "./catalog";
import { toJson, toLlmsTxt, toMarkdown } from "./exports";
import type { AppRow, EntryRow } from "./types";

const SHA = "b".repeat(40);
const apps: AppRow[] = [
  { slug: "a", name: "Alpha", tagline: "First app", url: "https://alpha.example", repo: "alpha", repoPrivate: false, defaultBranch: "main", license: null, licenseNote: null, kind: "app", position: 1, published: true },
  { slug: "p", name: "Priv", tagline: "Private stack", url: null, repo: "core", repoPrivate: true, defaultBranch: null, license: null, licenseNote: null, kind: "app", position: 2, published: true },
];
const entries: EntryRow[] = [
  {
    slug: "one", appSlug: "a", title: "One", summary: "Does one", body: null, audiences: ["members", "hosts"], tags: [], status: "live", access: "public",
    toggleKey: null, liveUrl: "/one", docsUrl: null, screenshotUrl: null, code: [{ repo: "PizzaDAO/alpha", path: "src/one.ts", description: "d" }], published: true, showWhenOff: false, position: 1,
  },
  {
    slug: "hidden", appSlug: "a", title: "Hidden", summary: "Unpublished", body: null, audiences: ["members"], status: "live", access: "public", tags: [],
    toggleKey: null, liveUrl: null, docsUrl: null, screenshotUrl: null, code: [], published: false, showWhenOff: false, position: 2,
  },
  {
    slug: "modules", appSlug: "p", title: "Modules", summary: "Private modules", body: null, audiences: ["partners"], tags: [], status: "private", access: "public",
    toggleKey: null, liveUrl: "https://private.example", docsUrl: null, screenshotUrl: null, code: [{ repo: "PizzaDAO/core", path: "src/x.ts" }, { repo: "PizzaDAO/kiosk", private: true }], published: true, showWhenOff: false, position: 3,
  },
];
const facts = new Map([["alpha", { private: false, defaultBranch: "main", license: "MIT", pushedAt: null, archived: false, commit: SHA }]]);
const catalog = buildPublicCatalog({ apps, entries, facts, githubOk: true, isOn: () => true, showOps: false, siteUrl: "https://site.example", now: new Date("2026-11-20T00:00:00Z") });
const o = { siteUrl: "https://site.example" };

describe("exports", () => {
  it("/features.json has the documented shape", () => {
    const j = toJson(catalog, o);
    expect(j.generatedAt).toBe("2026-11-20T00:00:00.000Z");
    expect(j.source).toBe("https://site.example/features");
    expect(j.apps[0]).toEqual({
      slug: "a", name: "Alpha", tagline: "First app", kind: "app", url: "https://alpha.example", repo: "PizzaDAO/alpha", defaultBranch: "main", commit: SHA, license: "MIT", licenseNote: null,
    });
    const one = j.features.find((f) => f.slug === "one")!;
    expect(one).toMatchObject({ app: "a", audiences: ["members", "hosts"], status: "live", access: "public", url: "https://alpha.example/one" });
    expect(one.code[0]).toEqual({
      repo: "PizzaDAO/alpha", path: "src/one.ts", description: "d",
      url: "https://github.com/PizzaDAO/alpha/blob/main/src/one.ts", permalink: `https://github.com/PizzaDAO/alpha/blob/${SHA}/src/one.ts`, license: "MIT",
    });
  });

  it("only published rows are exported, in every format", () => {
    const all = [JSON.stringify(toJson(catalog, o)), toMarkdown(catalog, o), toLlmsTxt(catalog, o)].join("\n");
    expect(all).not.toContain("Unpublished");
    expect(all).not.toContain("hidden");
  });

  it("private rows expose the repo name only: no path, URL or description in any export", () => {
    const j = toJson(catalog, o);
    const modules = j.features.find((f) => f.slug === "modules")!;
    expect(modules.status).toBe("coming-soon");
    expect(modules.url).toBeNull();
    expect(modules.code).toEqual([{ repo: "PizzaDAO/core", private: true }, { repo: "PizzaDAO/kiosk", private: true }]);
    const all = [JSON.stringify(j), toMarkdown(catalog, o), toLlmsTxt(catalog, o)].join("\n");
    expect(all).not.toContain("src/x.ts");
    expect(all).not.toContain("private.example");
    expect(all).not.toMatch(/github\.com\/PizzaDAO\/(core|kiosk)/);
    expect(toJson(catalog, o).apps.find((a) => a.slug === "p")).toMatchObject({ repo: null, commit: null });
  });

  it("/features.md lists an app heading, its license and one bullet per feature with code links", () => {
    const md = toMarkdown(catalog, o);
    expect(md).toContain("## Alpha");
    expect(md).toContain("License: MIT");
    expect(md).toContain("- **One** (live, Members, Event hosts): Does one Open: https://alpha.example/one. Code: [src/one.ts](https://github.com/PizzaDAO/alpha/blob/main/src/one.ts).");
    expect(md).toContain("- **Modules** (private, coming soon, Pizzerias & partners): Private modules Code: PizzaDAO/core (private), PizzaDAO/kiosk (private).");
    expect(md).toContain("License: No license file yet: ask before reusing code.");
  });

  it("escapes Markdown and collapses newlines in titles, summaries and names", () => {
    const evil = buildPublicCatalog({
      apps: [{ ...apps[0], name: "Al*pha [x](http://evil)", tagline: "line1\n# heading", url: "http://insecure.example" }],
      entries: [{ ...entries[0], title: "T_i`tle", summary: "a\n\n- [click](javascript:alert(1)) <b>x</b>" }],
      facts, githubOk: true, isOn: () => true, showOps: false, siteUrl: "https://site.example",
    });
    for (const out of [toMarkdown(evil, o), toLlmsTxt(evil, o)]) {
      expect(out).not.toMatch(/\[x\]\(http/);
      expect(out).not.toContain("\n# heading");
      expect(out).not.toContain("<b>");
      expect(out).not.toContain("http://insecure");
    }
    const md = toMarkdown(evil, o);
    expect(md).toContain("Al\\*pha \\[x\\]\\(http://evil\\)");
    expect(md).toContain("T\\_i\\`tle");
    expect(md).toContain("a - \\[click\\]\\(javascript:alert\\(1\\)\\) \\<b\\>x\\</b\\>");
    expect(JSON.stringify(toJson(evil, o))).not.toContain("http://insecure");
  });

  it("/llms.txt follows the convention: title, summary, then link lists", () => {
    const t = toLlmsTxt(catalog, o);
    expect(t.startsWith("# PizzaDAO\n\n> ")).toBe(true);
    expect(t).toContain("## Features");
    expect(t).toContain("(https://site.example/features.md)");
    expect(t).toContain("(https://site.example/features.json)");
    expect(t).toContain("## Apps");
    expect(t).toContain("- [Alpha](https://alpha.example): First app");
    expect(t).toContain("## Reuse");
  });
});
