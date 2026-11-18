import { describe, it, expect, vi, afterEach } from "vitest";
import { goBackOrFallback, recordInAppNavigation, NAV_COUNT_KEY } from "./go-back";

function setup(historyLength: number, canGoBack?: boolean) {
  const store = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  vi.stubGlobal("window", {
    history: { length: historyLength },
    navigation: canGoBack === undefined ? undefined : { canGoBack },
  });
  return { back: vi.fn(), push: vi.fn(), store };
}

describe("goBackOrFallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("direct landing falls back", () => {
    const r = setup(2);
    goBackOrFallback(r, "/crews");
    expect(r.push).toHaveBeenCalledWith("/crews");
    expect(r.back).not.toHaveBeenCalled();
  });

  it("external landing then in-app navigation goes back", () => {
    const r = setup(3);
    recordInAppNavigation();
    expect(r.store.get(NAV_COUNT_KEY)).toBe("1");
    goBackOrFallback(r, "/crews");
    expect(r.back).toHaveBeenCalled();
    expect(r.push).not.toHaveBeenCalled();
  });

  it("falls back when the Navigation API says it cannot go back", () => {
    const r = setup(3, false);
    recordInAppNavigation();
    goBackOrFallback(r, "/dashboard");
    expect(r.push).toHaveBeenCalledWith("/dashboard");
  });

  it("falls back with a single history entry", () => {
    const r = setup(1);
    recordInAppNavigation();
    goBackOrFallback(r, "/dashboard");
    expect(r.push).toHaveBeenCalledWith("/dashboard");
  });
});
