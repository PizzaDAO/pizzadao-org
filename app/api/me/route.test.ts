import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/session", () => ({
  getSession: vi.fn(),
  getSessionCookieOptions: vi.fn(() => ({ httpOnly: true, secure: false, sameSite: "lax", path: "/", maxAge: 100 })),
}));
vi.mock("@/app/lib/member-utils", () => ({ findMemberIdByDiscordId: vi.fn().mockResolvedValue("m1") }));

import { GET } from "./route";
import { getSession } from "@/app/lib/session";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/me hint cookie", () => {
  it("200 writes hint 1 (not httpOnly)", async () => {
    vi.mocked(getSession).mockResolvedValue({ discordId: "d1" } as never);
    const res = await GET();
    const c = res.headers.get("set-cookie") ?? "";
    expect(c).toMatch(/pizzadao_auth=1/);
    expect(c).not.toMatch(/httponly/i);
  });
  it("401 writes hint 0", async () => {
    vi.mocked(getSession).mockResolvedValue(null as never);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/pizzadao_auth=0/);
  });
});
