// app/api/x/callback/route.test.ts
//
// Covers the catch-all error path: an unexpected failure (e.g. the X token
// exchange throwing) used to return internalError's raw JSON 500, which
// rendered as an ugly error page since this route is hit via a top-level
// browser redirect, not a client-side fetch. It should redirect back to
// `/?x_error=failed` instead (read by <XConnectNotice/>), while still
// logging the error server-side.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/app/lib/x-oauth", () => ({
  verifyXState: vi.fn(),
  encryptToken: vi.fn((v: string) => `enc:${v}`),
}));

vi.mock("@/app/lib/db", () => ({
  prisma: { xAccount: { upsert: vi.fn() } },
}));

vi.mock("@/app/lib/sheet-utils", () => ({
  fetchWithRedirect: vi.fn(),
}));

vi.mock("@/app/lib/sheets/member-repository", () => ({
  fetchMemberIdByDiscordId: vi.fn(),
  invalidateMembersCache: vi.fn(),
}));

vi.mock("@/app/lib/mission-verify/events", () => ({
  emitMissionEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

import { GET } from "./route";
import { verifyXState } from "@/app/lib/x-oauth";
import { cookies } from "next/headers";

function callbackRequest(query: string) {
  return new Request(`http://localhost/api/x/callback?${query}`);
}

describe("GET /api/x/callback — catch-all error path", () => {
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redirects to /?x_error=failed (not a raw JSON 500) when the token exchange throws", async () => {
    vi.mocked(verifyXState).mockReturnValue({ discordId: "d1" });
    vi.mocked(cookies).mockResolvedValue({
      get: () => ({ value: "verifier" }),
      delete: vi.fn(),
    } as never);

    // exchangeCodeForToken's fetch() call blows up — simulates any
    // unexpected failure reaching the outer catch block.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const res = await GET(callbackRequest("code=abc123&state=sig"));

    expect(res.status).toBe(307); // NextResponse.redirect default
    expect(res.headers.get("location")).toBe("http://localhost/?x_error=failed");
    // Still logged server-side, same as internalError would have done.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[x/callback]",
      expect.any(Error)
    );
    // Never a JSON error body.
    expect(res.headers.get("content-type") ?? "").not.toMatch(/application\/json/);
  });
});
