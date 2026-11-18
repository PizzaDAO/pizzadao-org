import { describe, it, expect, vi, afterEach } from "vitest";
import { goBackOrFallback } from "./go-back";

function setup(historyLength: number, referrer: string) {
  vi.stubGlobal("window", {
    history: { length: historyLength },
    location: { origin: "https://app.example" },
  });
  vi.stubGlobal("document", { referrer });
  return { back: vi.fn(), push: vi.fn() };
}

describe("goBackOrFallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("goes back with same-origin history", () => {
    const r = setup(3, "https://app.example/crews");
    goBackOrFallback(r, "/crews");
    expect(r.back).toHaveBeenCalled();
    expect(r.push).not.toHaveBeenCalled();
  });

  it("falls back when there is no history", () => {
    const r = setup(1, "https://app.example/x");
    goBackOrFallback(r, "/crews");
    expect(r.push).toHaveBeenCalledWith("/crews");
  });

  it("falls back for external or empty referrers", () => {
    const a = setup(4, "https://other.example/");
    goBackOrFallback(a, "/dashboard");
    expect(a.push).toHaveBeenCalledWith("/dashboard");
    const b = setup(4, "");
    goBackOrFallback(b, "/dashboard");
    expect(b.push).toHaveBeenCalledWith("/dashboard");
  });
});
