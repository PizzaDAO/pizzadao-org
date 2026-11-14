// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/db", () => ({ prisma: {} }));

import seedJson from "@/data/features-seed.json";
import { isSettingKey } from "@/app/lib/settings/registry";
import { buildPublicCatalog } from "./catalog";
import { ENTRY_STATUSES, AUDIENCES, type Seed } from "./types";

const seed = seedJson as unknown as Seed;
const ROOT = path.resolve(__dirname, "../../..");

describe("data/features-seed.json", () => {
  it("every pizzadao-org code path exists in this checkout", () => {
    const missing: string[] = [];
    for (const e of seed.entries)
      for (const c of e.code)
        if (c.repo === "PizzaDAO/pizzadao-org" && c.path && !fs.existsSync(path.join(ROOT, c.path))) missing.push(`${e.slug}: ${c.path}`);
    expect(missing).toEqual([]);
  });

  it("is internally consistent: unique slugs, known apps, statuses and audiences, summaries within bounds", () => {
    const apps = new Set(seed.apps.map((a) => a.slug));
    expect(apps.size).toBe(seed.apps.length);
    expect(new Set(seed.entries.map((e) => e.slug)).size).toBe(seed.entries.length);
    for (const e of seed.entries) {
      expect(apps.has(e.appSlug), e.slug).toBe(true);
      expect(ENTRY_STATUSES as readonly string[]).toContain(e.status);
      for (const a of e.audiences) expect(AUDIENCES as readonly string[]).toContain(a);
      expect(e.summary.length, e.slug).toBeLessThanOrEqual(160);
      expect(e.access, e.slug).toMatch(/^(public|members|admin|level:\w+)$/);
    }
    for (const a of seed.apps) expect(a.tagline.length).toBeLessThanOrEqual(140);
  });

  it("every switch key is a real setting", () => {
    for (const e of seed.entries) if (e.toggleKey) expect(isSettingKey(e.toggleKey), `${e.slug}: ${e.toggleKey}`).toBe(true);
  });

  it("keeps repo text generic: no personal names or ids", () => {
    const text = JSON.stringify(seed);
    expect(text).not.toMatch(/Dread Pizza|Roberts|snax|samweinrott|@gmail|\b\d{17,20}\b/i);
  });

  it("records the chosen license (GPL-3.0) for the repos that now have a LICENSE file", () => {
    for (const a of seed.apps) if (!a.license) expect(a.licenseNote ?? "").not.toMatch(/MIT|Apache/);
    for (const slug of ["pizzadao-org", "rsvpizza", "rare-pizzas", "mixtape", "proof-of-pizza", "open-pizza", "zaave"]) expect(seed.apps.find((a) => a.slug === slug)!.license, slug).toBe("GPL-3.0");
    expect(seed.apps.find((a) => a.slug === "pizzadao-org")!.licenseNote).toBeNull();
  });

  it("the private Open Pizza modules row is private, with repo names only", () => {
    const row = seed.entries.find((e) => e.slug === "open-pizza-modules")!;
    expect(row.status).toBe("private");
    expect(row.code.length).toBeGreaterThan(0);
    for (const c of row.code) expect(c).toEqual({ repo: expect.stringMatching(/^PizzaDAO\//), private: true });
  });

  it("imported rows are hidden publicly until published (no row is published in the seed)", () => {
    expect(JSON.stringify(seed)).not.toContain('"published"');
  });

  it("when published, the private row exposes no code link anywhere", () => {
    const apps = seed.apps.map((a) => ({ ...a, published: true }));
    const entries = seed.entries.map((e) => ({ ...e, screenshotUrl: null, published: true, showWhenOff: false }));
    const cat = buildPublicCatalog({ apps, entries, facts: new Map(), githubOk: false, isOn: () => true, showOps: true, siteUrl: "https://site.example" });
    const row = cat.entries.find((e) => e.slug === "open-pizza-modules")!;
    expect(row.status).toBe("soon");
    expect(row.url).toBeNull();
    expect(row.code.every((c) => c.private && !c.url)).toBe(true);
  });
});
