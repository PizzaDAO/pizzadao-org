import { describe, it, expect } from "vitest";
import { prefetchRoute } from "./server-prefetch";

describe("prefetchRoute", () => {
  it("returns the parsed body on success and passes the path through", async () => {
    let seen = "";
    const out = await prefetchRoute<{ a: number }>(async (req) => {
      seen = (req as unknown as Request).url;
      return Response.json({ a: 1 });
    }, "/api/x?page=1");
    expect(out).toEqual({ a: 1 });
    expect(seen).toContain("/api/x?page=1");
  });

  it("returns null on a non-OK response", async () => {
    expect(await prefetchRoute(async () => Response.json({ error: "no" }, { status: 500 }), "/api/x")).toBeNull();
  });

  it("returns null when the handler throws", async () => {
    expect(await prefetchRoute(async () => { throw new Error("boom"); }, "/api/x")).toBeNull();
  });
});
