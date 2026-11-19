// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const existing = new Set<string>();
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return { ...actual, existsSync: (p: string) => existing.has(String(p).split(/[\\/]/).pop()!) };
});
const findMany = vi.fn();
const assignFindMany = vi.fn();
vi.mock("@/app/lib/db", () => ({
  prisma: {
    memberPfp: { findMany: (a: unknown) => findMany(a) },
    defaultPfpAssignment: { findMany: (a: unknown) => assignFindMany(a) },
  },
}));

import { resolvePfpUrlsAsync, resolvePfpUrlAsync } from "./pfp";

beforeEach(() => {
  existing.clear();
  findMany.mockReset();
  assignFindMany.mockReset();
  assignFindMany.mockResolvedValue([]);
});

describe("resolvePfpUrlsAsync", () => {
  it("prefers the composed URL, then the static file, then the default; one query for the batch", async () => {
    existing.add("1.jpg");
    existing.add("default.jpg");
    findMany.mockResolvedValue([{ memberId: "2", composedUrl: "https://x.public.blob.vercel-storage.com/pfp-composed/2-ab.webp" }]);
    const out = await resolvePfpUrlsAsync(["1", "2", "3", "1"]);
    expect(out).toEqual({
      "1": "/pfp/1.jpg",
      "2": "https://x.public.blob.vercel-storage.com/pfp-composed/2-ab.webp",
      "3": "/pfp/default.jpg",
    });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where.memberId.in).toEqual(["1", "2", "3"]);
  });

  it("composed wins over an existing static file", async () => {
    existing.add("1.jpg");
    findMany.mockResolvedValue([{ memberId: "1", composedUrl: "https://c" }]);
    expect(await resolvePfpUrlAsync("1")).toBe("https://c");
  });

  it("falls back to static answers when the database fails", async () => {
    existing.add("1.png");
    findMany.mockRejectedValue(new Error("no such table"));
    expect(await resolvePfpUrlsAsync(["1"])).toEqual({ "1": "/pfp/1.png" });
  });

  it("uses the default when nothing else exists, and never a Discord avatar", async () => {
    findMany.mockResolvedValue([]);
    const out = await resolvePfpUrlsAsync(["9"]);
    expect(out["9"]).toBe("/pfp/default.png");
    expect(JSON.stringify(out)).not.toContain("discordapp");
  });

  it("skips the query for unsafe ids", async () => {
    await resolvePfpUrlsAsync(["../x"]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("assigned dough ball", () => {
  it("order: composed, static art, assigned dough ball, shared default", async () => {
    existing.add("2.jpg");
    findMany.mockResolvedValue([{ memberId: "1", composedUrl: "https://c" }]);
    assignFindMany.mockResolvedValue([
      { memberId: "3", candidate: { imageUrl: "https://blob/dough-3.png" } },
    ]);
    const out = await resolvePfpUrlsAsync(["1", "2", "3", "4"]);
    expect(out).toEqual({
      "1": "https://c",
      "2": "/pfp/2.jpg",
      "3": "https://blob/dough-3.png",
      "4": "/pfp/default.png",
    });
    // only members with neither composed nor static art are looked up
    expect(assignFindMany.mock.calls[0][0].where.memberId.in).toEqual(["3", "4"]);
  });

  it("an assignment never overrides composed or static art", async () => {
    existing.add("2.png");
    findMany.mockResolvedValue([{ memberId: "1", composedUrl: "https://c" }]);
    assignFindMany.mockResolvedValue([
      { memberId: "1", candidate: { imageUrl: "https://blob/x.png" } },
      { memberId: "2", candidate: { imageUrl: "https://blob/y.png" } },
    ]);
    // the lookup is limited to needy ids, but even a stray row for a composed id must not win
    const out = await resolvePfpUrlsAsync(["1", "2"]);
    expect(out["1"]).toBe("https://c");
    expect(out["2"]).toBe("/pfp/2.png");
  });

  it("a failing assignment lookup keeps the default", async () => {
    findMany.mockResolvedValue([]);
    assignFindMany.mockRejectedValue(new Error("no such table"));
    expect((await resolvePfpUrlsAsync(["9"]))["9"]).toBe("/pfp/default.png");
  });
});
