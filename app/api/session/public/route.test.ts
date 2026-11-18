import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/app/lib/settings/toggles", () => ({ toggleEnabled: vi.fn() }));

import { GET } from "./route";
import { toggleEnabled } from "@/app/lib/settings/toggles";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/session/public", () => {
  it("is logged out, CDN-cacheable, and sets no cookie", async () => {
    vi.mocked(toggleEnabled).mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: false });
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=60, stale-while-revalidate=600");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("keeps the Proposals nav entry while the history is on", async () => {
    vi.mocked(toggleEnabled).mockResolvedValue(true);
    expect(await (await GET()).json()).toEqual({ authenticated: false, showProposals: true });
  });

  it("fails closed when the toggle lookup throws", async () => {
    vi.mocked(toggleEnabled).mockRejectedValue(new Error("db down"));
    expect(await (await GET()).json()).toEqual({ authenticated: false });
  });

  it("never reads cookies, headers or the session", () => {
    const src = readFileSync(join(__dirname, "route.ts"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).not.toMatch(/cookies|headers\(|getSession|next\/headers|\breq\b|request/i);
  });
});
