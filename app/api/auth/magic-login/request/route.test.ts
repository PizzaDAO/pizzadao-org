// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => { process.env.SESSION_SECRET ||= "test-secret"; return { request: vi.fn(), activation: vi.fn() }; });
vi.mock("@/app/lib/rate-limit", () => ({ enforceRateLimit: async () => null }));
vi.mock("@/app/lib/magic-login", () => ({ requestMagicLogin: mocks.request }));
vi.mock("@/app/lib/activation", () => ({ activationActor: () => undefined, recordActivationLater: mocks.activation }));
vi.mock("@/app/lib/referral-cookie", () => ({ readRefCookie: () => null }));
import { POST } from "./route";
import { readPendingIds } from "@/app/lib/magic-login-pending";

const call = (username: unknown) =>
  POST(new Request("https://app.example/api/auth/magic-login/request", { method: "POST", body: JSON.stringify({ username }) }));

beforeEach(() => vi.clearAllMocks());

describe("magic login request route", () => {
  it("returns 200 on sent", async () => {
    mocks.request.mockResolvedValue({ status: "sent", tokenId: "tok1" });
    expect((await call("a_user")).status).toBe(200);
  });
  it("returns 404 with username guidance on not_found", async () => {
    mocks.request.mockResolvedValue({ status: "not_found" });
    const res = await call("nobody");
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.status).toBe("not_found");
    expect(body.error).toMatch(/Discord username/);
    expect(body.error).toMatch(/joined the server/);
    expect(mocks.activation).toHaveBeenCalledWith("login_failed", expect.objectContaining({ code: "not_found" }));
  });
  it("returns 409 on ambiguous without naming members", async () => {
    mocks.request.mockResolvedValue({ status: "ambiguous" });
    const res = await call("sam");
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.status).toBe("ambiguous");
    expect(body.error).toMatch(/exact Discord username/);
    expect(mocks.activation).toHaveBeenCalledWith("login_failed", expect.objectContaining({ code: "ambiguous" }));
  });
  it("returns 503 on lookup_failed without the join hint", async () => {
    mocks.request.mockResolvedValue({ status: "lookup_failed" });
    const res = await call("sam");
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.error).toMatch(/busy/);
    expect(body.error).not.toMatch(/joined/);
    expect(mocks.activation).toHaveBeenCalledWith("login_failed", expect.objectContaining({ code: "lookup_failed" }));
  });
  it("keeps 429, 422 and the length check", async () => {
    mocks.request.mockResolvedValue({ status: "rate_limited" });
    expect((await call("sam")).status).toBe(429);
    mocks.request.mockResolvedValue({ status: "dm_failed", error: "dms_disabled" });
    expect((await call("sam")).status).toBe(422);
    expect((await call("x")).status).toBe(400);
  });
  it("adds the pd_lane cookie to the signup draft so a DM link on another device keeps the lane", async () => {
    mocks.request.mockResolvedValue({ status: "sent", tokenId: "tok1" });
    const draft = { mafiaName: "Tony Pepperoni", city: "Lisbon", sessionId: "test-session-1" };
    const send = (cookie: string | undefined, signupDraft: unknown) =>
      POST(new Request("https://app.example/api/auth/magic-login/request", {
        method: "POST",
        headers: cookie ? { cookie } : {},
        body: JSON.stringify({ username: "a_user", onboarding: true, signupDraft }),
      }));
    await send("pd_lane=host", draft);
    expect(mocks.request.mock.calls[0][2].signupDraft).toMatchObject({ lane: "host" });
    await send("pd_lane=../x", draft);
    expect(mocks.request.mock.calls[1][2].signupDraft).not.toHaveProperty("lane");
    await send("pd_lane=build", { ...draft, lane: "host" });
    expect(mocks.request.mock.calls[2][2].signupDraft).toMatchObject({ lane: "host" });
    await send("pd_lane=host", null);
    expect(mocks.request.mock.calls[3][2].signupDraft).toBeNull();
  });
  it("remembers in this browser which links it asked for (httpOnly, magic-login paths only)", async () => {
    mocks.request.mockResolvedValue({ status: "sent", tokenId: "tok1" });
    const first = await call("a_user");
    const cookie = first.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^pd_magic_pending=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/api/auth/magic-login");
    const value = decodeURIComponent(cookie.split(";")[0].slice("pd_magic_pending=".length));
    expect(readPendingIds(value)).toEqual(["tok1"]);

    mocks.request.mockResolvedValue({ status: "sent", tokenId: "tok2" });
    const second = await POST(new Request("https://app.example/api/auth/magic-login/request", {
      method: "POST",
      headers: { cookie: `pd_magic_pending=${encodeURIComponent(value)}` },
      body: JSON.stringify({ username: "a_user" }),
    }));
    const value2 = decodeURIComponent(second.headers.get("set-cookie")!.split(";")[0].slice("pd_magic_pending=".length));
    expect(readPendingIds(value2)).toEqual(["tok1", "tok2"]);
  });
  it("sets no pending cookie when nothing was sent", async () => {
    mocks.request.mockResolvedValue({ status: "not_found" });
    expect((await call("nobody")).headers.get("set-cookie")).toBeNull();
  });
});
