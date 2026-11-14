// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildPublicCatalog, publicStatus } from "./catalog";
import { codeUrl } from "./links";
import type { AppRow, EntryRow, RepoFactsMap } from "./types";

const app = (over: Partial<AppRow> = {}): AppRow => ({
  slug: "demo", name: "Demo", tagline: "A demo", url: "https://demo.example", repo: "demo-repo", repoPrivate: false,
  defaultBranch: "main", license: null, licenseNote: "No license yet, ask before reuse", kind: "app", position: 1, published: true, ...over,
});
const entry = (over: Partial<EntryRow> = {}): EntryRow => ({
  slug: "thing", appSlug: "demo", title: "Thing", summary: "Does a thing", body: null, audiences: ["members"], tags: [],
  status: "live", access: "public", toggleKey: null, liveUrl: "/thing", docsUrl: null, screenshotUrl: null,
  code: [{ repo: "PizzaDAO/demo-repo", path: "src/lib/thing.ts", description: "the thing" }],
  published: true, showWhenOff: false, position: 1, ...over,
});
const facts = (over: Record<string, Partial<{ private: boolean; defaultBranch: string; license: string | null; commit: string }>> = {}): RepoFactsMap =>
  new Map(Object.entries({ "demo-repo": {}, ...over }).map(([k, v]) => [k, { private: false, defaultBranch: "trunk", license: null, pushedAt: null, archived: false, commit: null, ...v }]));
const build = (o: Partial<Parameters<typeof buildPublicCatalog>[0]> = {}) =>
  buildPublicCatalog({ apps: [app()], entries: [entry()], facts: facts(), githubOk: true, isOn: () => true, showOps: false, siteUrl: "https://site.example", ...o });

describe("publicStatus (status follows the switch)", () => {
  it("is live with no switch, hidden for off/retired, and soon for private", () => {
    expect(publicStatus({ status: "live", toggleKey: null, showWhenOff: false }, () => true)).toBe("live");
    expect(publicStatus({ status: "beta", toggleKey: null, showWhenOff: false }, () => true)).toBe("beta");
    expect(publicStatus({ status: "off", toggleKey: null, showWhenOff: false }, () => true)).toBeNull();
    expect(publicStatus({ status: "retired", toggleKey: null, showWhenOff: true }, () => true)).toBeNull();
    expect(publicStatus({ status: "private", toggleKey: null, showWhenOff: false }, () => true)).toBe("soon");
  });
  it("follows the switch: on shows, off hides, off with showWhenOff is coming soon", () => {
    const e = { status: "live", toggleKey: "x.enabled", showWhenOff: false };
    expect(publicStatus(e, () => true)).toBe("live");
    expect(publicStatus(e, () => false)).toBeNull();
    expect(publicStatus({ ...e, showWhenOff: true }, () => false)).toBe("soon");
  });
  it("treats an unknown switch as off", () => {
    expect(publicStatus({ status: "live", toggleKey: "nope", showWhenOff: false }, () => null)).toBeNull();
  });
});

describe("buildPublicCatalog", () => {
  it("hides unpublished rows and rows of unpublished apps", () => {
    expect(build({ entries: [entry({ published: false })] }).entries).toHaveLength(0);
    expect(build({ apps: [app({ published: false })] }).entries).toHaveLength(0);
  });

  it("hides a row whose switch is off and shows it again when the switch flips", () => {
    const e = entry({ toggleKey: "demo.enabled" });
    expect(build({ entries: [e], isOn: () => false }).entries).toHaveLength(0);
    expect(build({ entries: [e], isOn: () => true }).entries[0].status).toBe("live");
    expect(build({ entries: [{ ...e, showWhenOff: true }], isOn: () => false }).entries[0].status).toBe("soon");
  });

  it("hides ops-only rows unless showOps", () => {
    const ops = entry({ audiences: ["ops"] });
    expect(build({ entries: [ops] }).entries).toHaveLength(0);
    const shown = build({ entries: [ops], showOps: true }).entries[0];
    expect(shown.ops).toBe(true);
    expect(build({ entries: [entry({ audiences: ["ops", "crews"] })] }).entries).toHaveLength(1);
  });

  it("builds default-branch links from GitHub's branch and pins the commit when known", () => {
    const sha = "a".repeat(40);
    const c = build({ facts: facts({ "demo-repo": { commit: sha, license: "MIT" } }) });
    const ref = c.entries[0].code[0];
    expect(ref.url).toBe("https://github.com/PizzaDAO/demo-repo/blob/trunk/src/lib/thing.ts");
    expect(ref.permalink).toBe(`https://github.com/PizzaDAO/demo-repo/blob/${sha}/src/lib/thing.ts`);
    expect(ref.license).toBe("MIT");
    expect(c.apps[0].license).toBe("MIT");
    expect(c.apps[0].commit).toBe(sha);
  });

  it("falls back to the stored branch and omits permalinks when GitHub is unavailable", () => {
    const c = build({ facts: new Map(), githubOk: false });
    expect(c.githubOk).toBe(false);
    expect(c.entries[0].code[0].url).toBe("https://github.com/PizzaDAO/demo-repo/blob/main/src/lib/thing.ts");
    expect(c.entries[0].code[0].permalink).toBeUndefined();
  });

  it("resolves relative live links against the app url, or the site url for the member app", () => {
    expect(build().entries[0].url).toBe("https://demo.example/thing");
    expect(build({ apps: [app({ url: null })] }).entries[0].url).toBe("https://site.example/thing");
  });

  it("never links javascript: urls and drops live links of admin-only rows", () => {
    expect(build({ entries: [entry({ liveUrl: "javascript:alert(1)", docsUrl: "javascript:alert(1)" })] }).entries[0].url).toBeNull();
    expect(build({ entries: [entry({ docsUrl: "javascript:alert(1)" })] }).entries[0].docsUrl).toBeNull();
    expect(build({ entries: [entry({ access: "admin" })] }).entries[0].url).toBeNull();
  });
});

describe("private rows never expose code links", () => {
  const privateRefs = [{ repo: "PizzaDAO/core", path: "src/secret.ts", description: "secret" }, { repo: "PizzaDAO/kiosk", private: true }];

  it("a private row lists repo names only", () => {
    const c = build({ entries: [entry({ status: "private", liveUrl: "https://x.example", docsUrl: "https://x.example/docs", code: privateRefs })] });
    const e = c.entries[0];
    expect(e.status).toBe("soon");
    expect(e.url).toBeNull();
    expect(e.docsUrl).toBeNull();
    expect(e.code).toEqual([{ repo: "PizzaDAO/core", private: true }, { repo: "PizzaDAO/kiosk", private: true }]);
    expect(JSON.stringify(c)).not.toMatch(/github\.com|secret\.ts/);
  });

  it("a code ref flagged private, in a private app, or missing from GitHub's public list is not linked", () => {
    const refs = [
      { repo: "PizzaDAO/demo-repo", path: "a.ts", private: true },
      { repo: "PizzaDAO/hidden", path: "b.ts" },
      { repo: "PizzaDAO/gone", path: "c.ts" },
    ];
    const c = build({ entries: [entry({ code: refs })], facts: facts({ hidden: { private: true } }) });
    expect(c.entries[0].code.every((r) => r.private === true && !r.url && !r.path)).toBe(true);
    const priv = build({ apps: [app({ repoPrivate: true })] });
    expect(priv.entries[0].code[0]).toEqual({ repo: "PizzaDAO/demo-repo", private: true });
    expect(priv.apps[0].repo).toBeNull();
  });
});

describe("codeUrl", () => {
  it("uses blob for files, tree for folders, encodes segments and handles the repo root", () => {
    expect(codeUrl("demo", "main", "app/lib/x")).toBe("https://github.com/PizzaDAO/demo/tree/main/app/lib/x");
    expect(codeUrl("demo", "main", "app/(marketing)/Reach.tsx")).toBe("https://github.com/PizzaDAO/demo/blob/main/app/(marketing)/Reach.tsx");
    expect(codeUrl("demo", "main", "app/[id]/page.tsx")).toContain("%5Bid%5D");
    expect(codeUrl("PizzaDAO/demo", "feat/x", "")).toBe("https://github.com/PizzaDAO/demo/tree/feat%2Fx");
  });
});
