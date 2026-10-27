// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const ex = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn(async () => ({})) }));
vi.mock("@/app/lib/db", () => ({ prisma: { memberProfileExtras: ex } }));

import { POST } from "./route";
import { signConfirm } from "@/app/lib/reengage/unsub-sig";

let saved: string | undefined;
beforeEach(() => { vi.clearAllMocks(); saved = process.env.SESSION_SECRET; process.env.SESSION_SECRET = "s"; });
afterEach(() => { if (saved === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = saved; });

const post = (m: string, t: string) =>
  new NextRequest(`https://app.pizzadao.org/api/email/confirm?m=${m}&t=${encodeURIComponent(t)}`, { method: "POST" });

describe("POST /api/email/confirm", () => {
  it("verifies the address the token was minted for", async () => {
    ex.findUnique.mockResolvedValue({ email: "a@x.io" });
    const res = await POST(post("42", signConfirm("42", "a@x.io")!));
    expect(res.status).toBe(303);
    expect(ex.update).toHaveBeenCalledWith(expect.objectContaining({ where: { memberId: "42" } }));
  });
  it("rejects a token for an address that has since changed, and a forged one", async () => {
    ex.findUnique.mockResolvedValue({ email: "new@x.io" });
    expect((await POST(post("42", signConfirm("42", "old@x.io")!))).status).toBe(400);
    expect((await POST(post("42", "9999999999999.forged"))).status).toBe(400);
    expect(ex.update).not.toHaveBeenCalled();
  });
});
