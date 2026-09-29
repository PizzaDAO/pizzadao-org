// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildGvizUrl, fetchGviz, fetchGvizText, gvizFetchInit, GvizFetchError } from "./gviz";

function gvizBody(table: unknown) {
  return `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({
    version: "0.6",
    status: "ok",
    table,
  })});`;
}

function mockFetchOnce(body: string, init: { ok?: boolean; status?: number } = {}) {
  const res = { ok: init.ok ?? true, status: init.status ?? 200, text: async () => body };
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(res);
}

beforeEach(() => {
  global.fetch = vi.fn();
});

describe("buildGvizUrl", () => {
  it("builds the base JSON URL for a sheet", () => {
    const url = new URL(buildGvizUrl("abc123"));
    expect(url.origin + url.pathname).toBe("https://docs.google.com/spreadsheets/d/abc123/gviz/tq");
    expect(url.searchParams.get("tqx")).toBe("out:json");
    expect(url.searchParams.has("sheet")).toBe(false);
    expect(url.searchParams.has("headers")).toBe(false);
  });

  it("encodes tab, gid, query and headers", () => {
    const url = new URL(
      buildGvizUrl("abc123", { tab: "Crew Mappings", gid: 42, query: "select A where B = 'x'", headers: 0 }),
    );
    expect(url.searchParams.get("sheet")).toBe("Crew Mappings");
    expect(url.searchParams.get("gid")).toBe("42");
    expect(url.searchParams.get("tq")).toBe("select A where B = 'x'");
    expect(url.searchParams.get("headers")).toBe("0");
    // Spaces in the tab name are escaped, not sent raw
    expect(buildGvizUrl("abc123", { tab: "Crew Mappings" })).not.toContain("Crew Mappings");
  });

  it("rejects an empty sheet id", () => {
    expect(() => buildGvizUrl("")).toThrow();
  });
});

describe("gvizFetchInit", () => {
  it("defaults to no-store when no cache policy is given", () => {
    expect(gvizFetchInit()).toEqual({ cache: "no-store" });
  });

  it("uses the Next data cache with revalidate + tags", () => {
    expect(gvizFetchInit({ revalidate: 120, tags: ["members"] })).toEqual({
      next: { revalidate: 120, tags: ["members"] },
    });
  });

  it("lets fresh override revalidate", () => {
    const init = gvizFetchInit({ fresh: true, revalidate: 300, headers: { "User-Agent": "x" } });
    expect(init.cache).toBe("no-store");
    expect(init.next).toBeUndefined();
    expect(init.headers).toEqual({ "User-Agent": "x" });
  });
});

describe("fetchGviz", () => {
  it("fetches the built URL with the cache options and parses the response", async () => {
    const table = {
      cols: [{ label: "Name" }],
      rows: [{ c: [{ v: "Name" }] }, { c: [{ v: "Pepper" }] }],
    };
    mockFetchOnce(gvizBody(table));

    const gviz = await fetchGviz("sheet-1", { tab: "Crew", headers: 0 }, { revalidate: 300 });

    expect(gviz.table).toEqual(table);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(buildGvizUrl("sheet-1", { tab: "Crew", headers: 0 }));
    expect(init).toEqual({ next: { revalidate: 300 } });
  });

  it("throws GvizFetchError with the status on a non-2xx response", async () => {
    mockFetchOnce("nope", { ok: false, status: 404 });
    const err = await fetchGviz("missing").catch((e) => e);
    expect(err).toBeInstanceOf(GvizFetchError);
    expect(err.status).toBe(404);
  });

  it("throws when Google returns an HTML page instead of JSON", async () => {
    mockFetchOnce("<!DOCTYPE html><html><body>Sign in</body></html>");
    await expect(fetchGvizText("private-sheet")).rejects.toThrow(/HTML/);
  });

  it("returns the raw body from fetchGvizText", async () => {
    const body = gvizBody({ rows: [] });
    mockFetchOnce(body);
    await expect(fetchGvizText("s", {}, { fresh: true })).resolves.toBe(body);
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual({ cache: "no-store" });
  });
});
