// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addPendingId, readPendingIds, readRequestCookie } from "./magic-login-pending";

beforeEach(() => vi.stubEnv("SESSION_SECRET", "test-secret"));

describe("magic login pending cookie", () => {
  it("round-trips signed ids and keeps only the newest three", () => {
    let v = "";
    for (const id of ["a1", "b2", "c3", "d4"]) v = addPendingId(v, id);
    expect(readPendingIds(v)).toEqual(["b2", "c3", "d4"]);
    expect(readPendingIds(addPendingId(v, "c3"))).toEqual(["b2", "d4", "c3"]);
  });
  it("rejects forged, tampered or foreign-secret entries", () => {
    const v = addPendingId(null, "tok1");
    expect(readPendingIds("tok1:forged")).toEqual([]);
    expect(readPendingIds(v.replace("tok1", "tok2"))).toEqual([]);
    vi.stubEnv("SESSION_SECRET", "other-secret");
    expect(readPendingIds(v)).toEqual([]);
  });
  it("ignores junk", () => {
    expect(readPendingIds(undefined)).toEqual([]);
    expect(readPendingIds("x".repeat(2000))).toEqual([]);
    expect(readPendingIds("a:b:c")).toEqual([]);
    expect(readPendingIds(addPendingId(null, "bad id!"))).toEqual([]);
  });
  it("reads one cookie from a Cookie header", () => {
    const req = new Request("https://app.example/", { headers: { cookie: "a=1; pd_magic_pending=x%3Ay; b=2" } });
    expect(readRequestCookie(req, "pd_magic_pending")).toBe("x:y");
    expect(readRequestCookie(req, "missing")).toBeUndefined();
  });
});
