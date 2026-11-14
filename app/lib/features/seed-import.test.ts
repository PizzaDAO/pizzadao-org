// @vitest-environment node
import { describe, expect, it } from "vitest";
import { importSeed, type SeedDb } from "./seed-import";
import type { Seed } from "./types";

/** An in-memory stand-in for the two tables, with Prisma's @updatedAt behaviour (set on every write unless given). */
function fakeDb() {
  let tick = 1_000;
  const clock = () => new Date((tick += 1000));
  const table = (key: string) => {
    const rows = new Map<string, Record<string, unknown>>();
    return {
      rows,
      findMany: async () => [...rows.values()].map((r) => ({ ...r })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        rows.set(data[key] as string, { ...data, updatedAt: (data.updatedAt as Date) ?? clock() });
      },
      update: async ({ where, data }: { where: Record<string, string>; data: Record<string, unknown> }) => {
        const cur = rows.get(where[key])!;
        rows.set(where[key], { ...cur, ...data, updatedAt: (data.updatedAt as Date) ?? clock() });
      },
    };
  };
  const featureApp = table("slug");
  const featureEntry = table("slug");
  return { db: { featureApp, featureEntry } as unknown as SeedDb, featureApp, featureEntry, clock };
}

const seed = (): Seed => ({
  version: 1,
  apps: [{ slug: "a", name: "A", tagline: "t", url: null, repo: "a", repoPrivate: false, defaultBranch: "main", license: null, licenseNote: null, kind: "app", position: 10 }],
  entries: [
    { slug: "e1", appSlug: "a", title: "One", summary: "s1", body: null, audiences: ["members"], tags: [], status: "live", access: "public", toggleKey: null, liveUrl: null, docsUrl: null, code: [{ repo: "PizzaDAO/a", path: "x" }], position: 10 },
    { slug: "e2", appSlug: "a", title: "Two", summary: "s2", body: null, audiences: ["hosts"], tags: [], status: "live", access: "public", toggleKey: null, liveUrl: null, docsUrl: null, code: [], position: 20 },
  ],
});

describe("importSeed", () => {
  it("creates every row unpublished", async () => {
    const f = fakeDb();
    const s = await importSeed(f.db, seed(), { now: f.clock() });
    expect(s.apps.created).toBe(1);
    expect(s.entries.created).toBe(2);
    expect([...f.featureEntry.rows.values()].every((r) => r.published === false)).toBe(true);
    expect([...f.featureApp.rows.values()].every((r) => r.published === false)).toBe(true);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const f = fakeDb();
    await importSeed(f.db, seed(), { now: f.clock() });
    const before = JSON.stringify([...f.featureEntry.rows.values()]);
    const s = await importSeed(f.db, seed(), { now: f.clock() });
    expect(s.entries).toEqual({ created: 0, refreshed: 0, unchanged: 2, keptEdited: 0 });
    expect(s.apps).toEqual({ created: 0, refreshed: 0, unchanged: 1, keptEdited: 0 });
    expect(JSON.stringify([...f.featureEntry.rows.values()])).toBe(before);
  });

  it("never overwrites a row an admin edited", async () => {
    const f = fakeDb();
    await importSeed(f.db, seed(), { now: f.clock() });
    await f.featureEntry.update({ where: { slug: "e1" }, data: { title: "Edited by admin", published: true, editedAt: f.clock() } });
    const changed = seed();
    changed.entries[0].title = "Seed changed";
    changed.entries[1].summary = "s2 changed";
    const s = await importSeed(f.db, changed, { now: f.clock() });
    expect(s.entries.keptEdited).toBe(1);
    expect(s.keptEditedSlugs).toEqual(["e1"]);
    expect(f.featureEntry.rows.get("e1")!.title).toBe("Edited by admin");
    expect(f.featureEntry.rows.get("e1")!.published).toBe(true);
    // The untouched row is refreshed from the seed.
    expect(s.entries.refreshed).toBe(1);
    expect(f.featureEntry.rows.get("e2")!.summary).toBe("s2 changed");
  });

  it("publishing or marking reviewed (no editedAt) does not freeze a row against refresh", async () => {
    const f = fakeDb();
    await importSeed(f.db, seed(), { now: f.clock() });
    await f.featureEntry.update({ where: { slug: "e1" }, data: { published: true, reviewedAt: f.clock() } });
    const changed = seed();
    changed.entries[0].summary = "newer";
    const s = await importSeed(f.db, changed, { now: f.clock() });
    expect(s.entries.refreshed).toBe(1);
    expect(f.featureEntry.rows.get("e1")!.summary).toBe("newer");
    expect(f.featureEntry.rows.get("e1")!.published).toBe(true);
  });

  it("compares stored JSON regardless of key order", async () => {
    const f = fakeDb();
    await importSeed(f.db, seed(), { now: f.clock() });
    // JSONB hands keys back in a different order.
    f.featureEntry.rows.get("e1")!.code = [{ path: "x", repo: "PizzaDAO/a" }];
    const s = await importSeed(f.db, seed(), { now: f.clock() });
    expect(s.entries.unchanged).toBe(2);
    expect(s.entries.refreshed).toBe(0);
  });

  it("refreshing keeps an unedited row's published choice and does not make it look edited", async () => {
    const f = fakeDb();
    await importSeed(f.db, seed(), { now: f.clock() });
    // A link-check style write keeps updatedAt, so it is not an edit.
    const row = f.featureEntry.rows.get("e2")!;
    await f.featureEntry.update({ where: { slug: "e2" }, data: { linkCheck: { ok: true }, updatedAt: row.updatedAt } });
    const changed = seed();
    changed.entries[1].summary = "newer";
    const s = await importSeed(f.db, changed, { now: f.clock() });
    expect(s.entries.refreshed).toBe(1);
    expect(f.featureEntry.rows.get("e2")!.published).toBe(false);
    const s2 = await importSeed(f.db, changed, { now: f.clock() });
    expect(s2.entries.unchanged).toBe(2);
  });

  it("leaves hand-made rows (never imported) alone", async () => {
    const f = fakeDb();
    await f.featureEntry.create({ data: { slug: "e1", title: "Mine", published: true } });
    const s = await importSeed(f.db, { ...seed(), apps: [] }, { now: f.clock() });
    expect(s.entries.keptEdited).toBe(1);
    expect(f.featureEntry.rows.get("e1")!.title).toBe("Mine");
  });
});
