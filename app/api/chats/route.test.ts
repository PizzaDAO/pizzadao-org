import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getSession = vi.fn();
vi.mock("@/app/lib/session", () => ({ getSession: () => getSession() }));

import { GET } from "./route";

describe("/api/chats", () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ discordId: "1" });
    vi.stubEnv("RSVPIZZA_SUPABASE_URL", "");
    vi.stubEnv("RSVPIZZA_SUPABASE_ANON_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns a generic message (not env var names) when config is missing", async () => {
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).not.toMatch(/RSVPIZZA|must be set/);
    expect(console.error).toHaveBeenCalled();
  });
});
