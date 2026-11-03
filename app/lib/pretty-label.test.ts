import { describe, it, expect } from "vitest";
import { prettyLabel } from "./pretty-label";

describe("prettyLabel", () => {
  it("replaces underscores and capitalises", () => {
    expect(prettyLabel("content_creation")).toBe("Content creation");
    expect(prettyLabel("ops_task")).toBe("Ops task");
  });
  it("falls back when empty", () => {
    expect(prettyLabel(null)).toBe("General");
    expect(prettyLabel("  _ ")).toBe("General");
  });
});
