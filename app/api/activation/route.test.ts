import { describe, it, expect, vi, beforeEach } from "vitest";

const recordActivation = vi.fn();
vi.mock("@/app/lib/activation", async (orig) => ({
  ...(await orig<typeof import("@/app/lib/activation")>()),
  recordActivation: (...a: unknown[]) => recordActivation(...a),
}));
vi.mock("@/app/lib/rate-limit", () => ({ enforceRateLimit: async () => null }));

import { POST } from "./route";

const post = (o: Record<string, unknown>) =>
  POST(new Request("http://x/api/activation", { method: "POST", body: JSON.stringify({ actor: "session-abc123", ...o }) }));

describe("POST /api/activation funnel events", () => {
  beforeEach(() => recordActivation.mockReset());

  it("records each mafia-name funnel event with its code", async () => {
    for (const [event, code] of [
      ["topping_picked", "pepperoni"],
      ["film_picked", "godfather"],
      ["names_generated", "ok"],
      ["name_rerolled", "r2"],
    ]) {
      expect((await post({ event, code })).status).toBe(204);
      expect(recordActivation).toHaveBeenLastCalledWith(event, { actor: "session-abc123", code });
    }
  });

  it("rejects codes outside the closed vocabulary", async () => {
    expect((await post({ event: "topping_picked", code: "free_text_here" })).status).toBe(400);
    expect((await post({ event: "name_rerolled", code: "r99" })).status).toBe(400);
    expect(recordActivation).not.toHaveBeenCalled();
  });

  it("does not let the browser report server-side events", async () => {
    expect((await post({ event: "name_claimed", code: "ok" })).status).toBe(400);
    expect((await post({ event: "portrait_generated", code: "ok" })).status).toBe(400);
  });

  it("still records signup_started without a code", async () => {
    expect((await post({ event: "signup_started", code: "" })).status).toBe(204);
    expect(recordActivation).toHaveBeenLastCalledWith("signup_started", { actor: "session-abc123", code: undefined });
  });
});
