// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const existing = new Set<string>();

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: (p: string) => existing.has(String(p).split(/[\\/]/).pop()!),
  };
});

import { resolvePfpUrl, resolvePfpUrls } from "./pfp";

beforeEach(() => {
  existing.clear();
});

describe("resolvePfpUrl", () => {
  it("prefers jpg, then png, then the default image", () => {
    existing.add("5.jpg");
    existing.add("5.png");
    existing.add("6.png");
    existing.add("default.jpg");
    expect(resolvePfpUrl("5")).toBe("/pfp/5.jpg");
    expect(resolvePfpUrl(6)).toBe("/pfp/6.png");
    expect(resolvePfpUrl("7")).toBe("/pfp/default.jpg");
  });

  it("returns null when there is no image and no default", () => {
    expect(resolvePfpUrl("7")).toBeNull();
  });

  it("never builds a path from an unsafe id", () => {
    existing.add("default.png");
    expect(resolvePfpUrl("../secret")).toBe("/pfp/default.png");
  });
});

describe("resolvePfpUrls", () => {
  it("resolves many ids in one pass, de-duplicated", () => {
    existing.add("1.jpg");
    expect(resolvePfpUrls(["1", "2", "1", " "])).toEqual({ "1": "/pfp/1.jpg", "2": null });
  });
});
