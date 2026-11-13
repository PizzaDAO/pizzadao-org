import { afterEach, describe, expect, it, vi } from "vitest";
import { countryFill, fetchMapLevels, markerRadius, parseMapLevels } from "./mapLevels";

const good = {
  version: 1,
  generatedAt: "2026-11-10T00:00:00Z",
  tiers: [
    { level: 1, name: "Dough" },
    { level: 2, name: "Sauce" },
  ],
  cities: [{ key: "lagos-566", name: "Lagos", country: "NG", level: 2, members: "10+" }],
  countries: [{ iso2: "NG", isoNumeric: "566", name: "Nigeria", level: 2 }],
};

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });

afterEach(() => vi.unstubAllGlobals());

describe("fetchMapLevels", () => {
  it("returns the data when the app answers", async () => {
    vi.stubGlobal("fetch", respond(200, good));
    expect((await fetchMapLevels("https://x/y"))?.cities[0].key).toBe("lagos-566");
  });

  it("returns null on 404 (switch off), 503, network error, bad shape and timeout", async () => {
    vi.stubGlobal("fetch", respond(404, { enabled: false }));
    expect(await fetchMapLevels("https://x/y")).toBeNull();
    vi.stubGlobal("fetch", respond(503, { error: "unavailable" }));
    expect(await fetchMapLevels("https://x/y")).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await fetchMapLevels("https://x/y")).toBeNull();
    vi.stubGlobal("fetch", respond(200, { version: 2 }));
    expect(await fetchMapLevels("https://x/y")).toBeNull();
    vi.stubGlobal("fetch", respond(200, { ...good, cities: [{ key: 1 }] }));
    expect(await fetchMapLevels("https://x/y")).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: string, init: { signal: AbortSignal }) =>
          new Promise((_r, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted")))),
      ),
    );
    expect(await fetchMapLevels("https://x/y", 10)).toBeNull();
  });
});

describe("parseMapLevels", () => {
  it("rejects empty tiers and non-objects", () => {
    expect(parseMapLevels({ ...good, tiers: [] })).toBeNull();
    expect(parseMapLevels(null)).toBeNull();
    expect(parseMapLevels("nope")).toBeNull();
  });
});

describe("styling", () => {
  it("markers grow and fills deepen with the tier", () => {
    expect(markerRadius(1, 4)).toBe(2.6);
    expect(markerRadius(4, 4)).toBe(5);
    expect(markerRadius(2, 4)).toBeGreaterThan(markerRadius(1, 4));
    expect(countryFill(1, 4)).not.toBe(countryFill(4, 4));
    expect(markerRadius(1, 1)).toBe(2.6);
  });
});
