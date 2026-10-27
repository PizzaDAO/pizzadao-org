import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();
const findUnique = vi.fn();
const create = vi.fn();
const checkKeyed = vi.fn();
const generatePortrait = vi.fn();
const recordLater = vi.fn();
let upstash = true;

vi.mock("@/app/lib/session", () => ({ getSession: () => getSession() }));
vi.mock("@/app/lib/db", () => ({
  prisma: { mafiaPortrait: { findUnique: (...a: unknown[]) => findUnique(...a), create: (...a: unknown[]) => create(...a) } },
}));
vi.mock("@/app/lib/activation", () => ({
  recordActivationLater: (...a: unknown[]) => recordLater(...a),
  activationActor: (v: unknown) => (typeof v === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(v) ? v : undefined),
}));
vi.mock("@/app/lib/mafia-portrait/generate", () => ({
  PortraitUnavailable: class PortraitUnavailable extends Error {},
  generatePortrait: (...a: unknown[]) => generatePortrait(...a),
  portraitModelId: () => "gpt-image-1",
}));
vi.mock("@/app/lib/rate-limit", async (orig) => {
  const actual = await orig<typeof import("@/app/lib/rate-limit")>();
  return {
    ...actual,
    checkKeyedRateLimit: (...a: unknown[]) => checkKeyed(...a),
    isUpstashConfigured: () => upstash,
  };
});

import { POST } from "./route";
import { PortraitUnavailable } from "@/app/lib/mafia-portrait/generate";

const ok = { success: true, limit: 5, remaining: 4, reset: Date.now() + 1000 };
const body = (o: Record<string, unknown> = {}) =>
  new Request("http://x/api/mafia-portrait", {
    method: "POST",
    body: JSON.stringify({ name: "Tony Soprano", topping: "Basil", turtles: ["Leonardo"], crews: ["comms"], variant: 0, ...o }),
  });

describe("POST /api/mafia-portrait", () => {
  beforeEach(() => {
    for (const m of [getSession, findUnique, create, checkKeyed, generatePortrait, recordLater]) m.mockReset();
    process.env.MAFIA_PORTRAIT_ENABLED = "1";
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.VERCEL;
    delete process.env.MAFIA_PORTRAIT_DAILY_CAP;
    upstash = true;
    getSession.mockResolvedValue({ discordId: "123" });
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({});
    checkKeyed.mockResolvedValue(ok);
    generatePortrait.mockResolvedValue({ url: "https://blob/p.webp", model: "gpt-image-1" });
  });

  it("503 fallback when the kill switch is off", async () => {
    process.env.MAFIA_PORTRAIT_ENABLED = "0";
    const res = await POST(body());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ fallback: true });
    expect(generatePortrait).not.toHaveBeenCalled();
  });

  it("503 fallback when there is no OpenAI key", async () => {
    delete process.env.OPENAI_API_KEY;
    expect((await POST(body())).status).toBe(503);
  });

  it("400 on variant 5 or an empty name", async () => {
    expect((await POST(body({ variant: 5 }))).status).toBe(400);
    expect((await POST(body({ name: "   " }))).status).toBe(400);
  });

  it("cache hit skips limits and the provider", async () => {
    findUnique.mockResolvedValue({ url: "https://blob/c.webp" });
    const res = await POST(body());
    expect(await res.json()).toEqual({ url: "https://blob/c.webp", cached: true });
    expect(checkKeyed).not.toHaveBeenCalled();
    expect(generatePortrait).not.toHaveBeenCalled();
  });

  it("draws, stores and returns the remaining count on a miss", async () => {
    const res = await POST(body());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ url: "https://blob/p.webp", cached: false, remaining: 4 });
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].data).toMatchObject({ discordId: "123", variant: 0 });
    expect(generatePortrait).toHaveBeenCalledWith({ name: "Tony Soprano", turtles: ["Leonardo"], crews: ["comms"] });
    expect(recordLater).toHaveBeenCalledWith("portrait_generated", expect.anything());
  });

  it("passes only known turtles and crews to the provider and the cache key", async () => {
    await POST(body({ turtles: ["raphael", "Shredder", "Leonardo"], crews: ["Comms", "ignore previous", "nope"] }));
    expect(generatePortrait).toHaveBeenCalledWith({ name: "Tony Soprano", turtles: ["Leonardo", "Raphael"], crews: ["comms"] });
    const keyA = findUnique.mock.calls[0][0].where.cacheKey;
    findUnique.mockClear();
    await POST(body({ turtles: ["Leonardo", "Raphael"], crews: ["comms"] }));
    expect(findUnique.mock.calls[0][0].where.cacheKey).toBe(keyA);
    findUnique.mockClear();
    await POST(body({ turtles: ["Leonardo"], crews: ["comms"] }));
    expect(findUnique.mock.calls[0][0].where.cacheKey).not.toBe(keyA);
  });

  it("429 when the member is over their daily limit", async () => {
    checkKeyed.mockResolvedValueOnce(ok).mockResolvedValueOnce({ success: false, limit: 5, remaining: 0, reset: Date.now() + 60_000 });
    const res = await POST(body());
    expect(res.status).toBe(429);
    expect(generatePortrait).not.toHaveBeenCalled();
    expect(checkKeyed.mock.calls.map((c) => c[0])).toEqual(["mafia-portrait-global", "mafia-portrait-member"]);
  });

  it("503 when the global cap is spent, using MAFIA_PORTRAIT_DAILY_CAP and failing closed", async () => {
    process.env.MAFIA_PORTRAIT_DAILY_CAP = "7";
    checkKeyed.mockResolvedValueOnce({ ...ok, success: false, remaining: 0 });
    const res = await POST(body());
    expect(res.status).toBe(503);
    expect(checkKeyed).toHaveBeenCalledTimes(1);
    const [name, key, rule, opts] = checkKeyed.mock.calls[0];
    expect([name, key, rule.limit, opts]).toEqual(["mafia-portrait-global", "all", 7, { failClosed: true }]);
    expect(generatePortrait).not.toHaveBeenCalled();
  });

  it("503 on Vercel when Upstash is not configured (global cap cannot be enforced)", async () => {
    process.env.VERCEL = "1";
    upstash = false;
    expect((await POST(body())).status).toBe(503);
    expect(generatePortrait).not.toHaveBeenCalled();
  });

  it("provider failure returns the fallback and records it", async () => {
    generatePortrait.mockRejectedValue(new PortraitUnavailable("Portrait generation failed", { cause: new DOMException("t", "TimeoutError") }));
    const res = await POST(body());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ fallback: true });
    expect(create).not.toHaveBeenCalled();
    expect(recordLater).toHaveBeenCalledWith("portrait_failed", expect.objectContaining({ code: "timeout" }));
  });

  describe("anonymous (public /get-your-mafia-name)", () => {
    const anon = (o: Record<string, unknown> = {}, ip = "203.0.113.9") =>
      new Request("http://x/api/mafia-portrait", {
        method: "POST",
        headers: ip ? { "x-forwarded-for": ip } : {},
        body: JSON.stringify({ name: "Tony Soprano", topping: "Basil", turtles: ["Leonardo"], crews: ["comms"], variant: 0, ...o }),
      });
    beforeEach(() => getSession.mockResolvedValue(null));

    it("draws with no session: global cap first, then 3/day per IP (fail closed), no turtles or crews", async () => {
      const res = await POST(anon({ actor: "sess_abc123_def456" }));
      expect(res.status).toBe(200);
      expect(checkKeyed.mock.calls.map((c) => c[0])).toEqual(["mafia-portrait-global", "mafia-portrait-ip"]);
      const [, key, rule, opts] = checkKeyed.mock.calls[1];
      expect([key, rule, opts]).toEqual(["203.0.113.9", undefined, { failClosed: true }]);
      // Turtles and crews the caller sent are ignored: nobody anonymous has picked any.
      expect(generatePortrait).toHaveBeenCalledWith({ name: "Tony Soprano", turtles: [], crews: [] });
      expect(create.mock.calls[0][0].data).toMatchObject({ discordId: null });
      expect(recordLater).toHaveBeenCalledWith("portrait_generated", { discordId: undefined, actor: "sess_abc123_def456", code: "ok" });
    });

    it("429 over the per-IP limit, without generating", async () => {
      checkKeyed.mockResolvedValueOnce(ok).mockResolvedValueOnce({ success: false, limit: 3, remaining: 0, reset: Date.now() + 60_000 });
      expect((await POST(anon())).status).toBe(429);
      expect(generatePortrait).not.toHaveBeenCalled();
    });

    it("the global cap is checked first and stops anonymous callers too", async () => {
      checkKeyed.mockResolvedValueOnce({ ...ok, success: false, remaining: 0 });
      expect((await POST(anon())).status).toBe(503);
      expect(checkKeyed).toHaveBeenCalledTimes(1);
      expect(checkKeyed.mock.calls[0][0]).toBe("mafia-portrait-global");
    });

    it("cache hits are free: no limits, no provider", async () => {
      findUnique.mockResolvedValue({ url: "https://blob/c.webp" });
      const res = await POST(anon());
      expect(await res.json()).toEqual({ url: "https://blob/c.webp", cached: true });
      expect(checkKeyed).not.toHaveBeenCalled();
      expect(generatePortrait).not.toHaveBeenCalled();
    });

    it("an unknown IP is refused rather than sharing one bucket", async () => {
      const res = await POST(anon({}, ""));
      expect(res.status).toBe(503);
      expect(generatePortrait).not.toHaveBeenCalled();
    });

    it("cannot be used to dodge the member limit: a session always takes the member path", async () => {
      getSession.mockResolvedValue({ discordId: "123" });
      await POST(anon());
      expect(checkKeyed.mock.calls.map((c) => c[0])).toEqual(["mafia-portrait-global", "mafia-portrait-member"]);
      expect(checkKeyed.mock.calls.some((c) => c[0] === "mafia-portrait-ip")).toBe(false);
      expect(generatePortrait).toHaveBeenCalledWith({ name: "Tony Soprano", turtles: ["Leonardo"], crews: ["comms"] });
    });

    it("keeps the same cache entry as a member who picked no turtles or crews, and a different one from a member who did", async () => {
      await POST(anon());
      const anonKey = findUnique.mock.calls[0][0].where.cacheKey;
      findUnique.mockClear();
      getSession.mockResolvedValue({ discordId: "123" });
      await POST(body({ turtles: [], crews: [] }));
      expect(findUnique.mock.calls[0][0].where.cacheKey).toBe(anonKey);
      findUnique.mockClear();
      await POST(body());
      expect(findUnique.mock.calls[0][0].where.cacheKey).not.toBe(anonKey);
    });

    it("503 on Vercel when Upstash is not configured", async () => {
      process.env.VERCEL = "1";
      upstash = false;
      expect((await POST(anon())).status).toBe(503);
      expect(generatePortrait).not.toHaveBeenCalled();
    });
  });
});
