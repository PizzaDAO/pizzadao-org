// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), activation: vi.fn() }));
vi.mock("@/app/lib/rate-limit", () => ({ enforceRateLimit: async () => null }));
vi.mock("@/app/lib/magic-login", () => ({ requestMagicLogin: mocks.request }));
vi.mock("@/app/lib/activation", () => ({ activationActor: () => undefined, recordActivationLater: mocks.activation }));
vi.mock("@/app/lib/referral-cookie", () => ({ readRefCookie: () => null }));
import { POST } from "./route";

const call = (username: unknown) =>
  POST(new Request("https://app.example/api/auth/magic-login/request", { method: "POST", body: JSON.stringify({ username }) }));

beforeEach(() => vi.clearAllMocks());

describe("magic login request route", () => {
  it("returns 200 on sent", async () => {
    mocks.request.mockResolvedValue({ status: "sent" });
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
});
