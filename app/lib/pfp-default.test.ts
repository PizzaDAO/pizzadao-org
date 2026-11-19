import { describe, it, expect } from "vitest";
import { existsSync, statSync } from "fs";
import path from "path";
import { DEFAULT_PFP_URL, pfpOrDefault } from "./pfp-default";

describe("default PFP", () => {
  it("ships a real image file at the default URL", () => {
    const file = path.join(process.cwd(), "public", DEFAULT_PFP_URL);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(1000);
  });

  it("public/placeholder-avatar.png is a real image too", () => {
    expect(statSync(path.join(process.cwd(), "public", "placeholder-avatar.png")).size).toBeGreaterThan(1000);
  });

  it("pfpOrDefault keeps a real PFP and falls back to the default for null, undefined, and empty", () => {
    expect(pfpOrDefault("/pfp/5.jpg")).toBe("/pfp/5.jpg");
    for (const v of [null, undefined, ""]) expect(pfpOrDefault(v)).toBe(DEFAULT_PFP_URL);
  });
});
