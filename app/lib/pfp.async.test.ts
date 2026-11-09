// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const existing = new Set<string>();
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return { ...actual, existsSync: (p: string) => existing.has(String(p).split(/[\\/]/).pop()!) };
});
const findMany = vi.fn();
vi.mock("@/app/lib/db", () => ({ prisma: { memberPfp: { findMany: (a: unknown) => findMany(a) } } }));

import { resolvePfpUrlsAsync, resolvePfpUrlAsync } from "./pfp";

beforeEach(() => {
  existing.clear();
  findMany.mockReset();
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

  it("skips the query for unsafe ids", async () => {
    await resolvePfpUrlsAsync(["../x"]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
