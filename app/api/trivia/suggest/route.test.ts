// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const session = vi.hoisted(() => ({ value: null as null | { discordId: string } }));
vi.mock("@/app/lib/session", () => ({ getSession: async () => session.value }));
vi.mock("@/app/lib/db");
vi.mock("@/app/lib/trivia/suggestions", () => ({
  submitSuggestion: vi.fn(),
  suggestionsRemaining: vi.fn(async () => 3),
}));

import { GET, POST } from "./route";
import { submitSuggestion } from "@/app/lib/trivia/suggestions";

const post = (body: unknown, ip = "1.1.1.1") =>
  POST(new NextRequest("https://x.test/api/trivia/suggest", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }));
const form = { question: "Which bitcointalk user proposed the word satoshi?", answer: "ribuck", aliases: "", source: "https://bitcointalk.org/x" };

beforeEach(() => {
  session.value = { discordId: "111" };
  vi.mocked(submitSuggestion).mockReset();
  vi.mocked(submitSuggestion).mockResolvedValue({ status: "recorded", id: 1 });
});

describe("POST /api/trivia/suggest", () => {
  it("needs a Discord session", async () => {
    session.value = null;
    const res = await post(form, "2.2.2.2");
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("SIGN_IN");
    expect(submitSuggestion).not.toHaveBeenCalled();
  });

  it("stores a suggestion for the signed-in member", async () => {
    const res = await post(form, "3.3.3.3");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(submitSuggestion).toHaveBeenCalledWith("111", expect.objectContaining({ answer: "ribuck", source: "https://bitcointalk.org/x" }));
  });

  it("a bad field is a 400 naming the field; the daily cap is a 429", async () => {
    vi.mocked(submitSuggestion).mockResolvedValueOnce({ status: "invalid", field: "source" });
    const bad = await post({ ...form, source: "nope" }, "4.4.4.4");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "INVALID", field: "source" });
    vi.mocked(submitSuggestion).mockResolvedValueOnce({ status: "limit" });
    const limit = await post(form, "5.5.5.5");
    expect(limit.status).toBe(429);
    expect((await limit.json()).code).toBe("LIMIT");
  });

  it("a storage failure is a 503, never a 500 with details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(submitSuggestion).mockRejectedValueOnce(new Error("relation does not exist"));
    const res = await post(form, "6.6.6.6");
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("relation");
  });

  it("is rate limited per member (10 per 10 minutes)", async () => {
    session.value = { discordId: "999" };
    const codes: number[] = [];
    for (let n = 0; n < 12; n++) codes.push((await post(form, `7.7.7.${n}`)).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });
});

describe("GET /api/trivia/suggest", () => {
  it("tells a visitor to sign in, and a member how many suggestions are left", async () => {
    session.value = null;
    expect(await (await GET(new NextRequest("https://x.test/api/trivia/suggest", { headers: { "x-forwarded-for": "8.8.8.8" } }))).json()).toEqual({ signedIn: false });
    session.value = { discordId: "111" };
    expect(await (await GET(new NextRequest("https://x.test/api/trivia/suggest", { headers: { "x-forwarded-for": "8.8.8.9" } }))).json()).toEqual({ signedIn: true, remaining: 3, limit: 5 });
  });
});
