// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const upsert = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/app/lib/db", () => ({ prisma: { memberProfileExtras: { upsert } } }));

import { POST } from "./route";
import { signUnsubscribe } from "@/app/lib/reengage/unsub-sig";

let saved: string | undefined;
beforeEach(() => { vi.clearAllMocks(); saved = process.env.SESSION_SECRET; process.env.SESSION_SECRET = "s"; });
afterEach(() => { if (saved === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = saved; });

const post = (qs: string, type?: string) =>
  new NextRequest(`https://app.pizzadao.org/api/email/unsubscribe?${qs}`, {
    method: "POST",
    headers: type ? { "content-type": type } : {},
    body: type ? "List-Unsubscribe=One-Click" : undefined,
  });

describe("POST /api/email/unsubscribe", () => {
  it("opts the member out with a valid signature (one-click)", async () => {
    const res = await POST(post(`m=42&s=${signUnsubscribe("42")}`, "application/x-www-form-urlencoded"));
    expect(res.status).toBe(303); // form posts go back to the confirmation page
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { memberId: "42" }, update: { reengageEmailOptOut: true } }));
  });
  it("returns JSON for non-form callers", async () => {
    const res = await POST(post(`m=42&s=${signUnsubscribe("42")}`));
    expect(await res.json()).toEqual({ ok: true });
  });
  it("rejects a bad or foreign signature without writing", async () => {
    expect((await POST(post(`m=43&s=${signUnsubscribe("42")}`))).status).toBe(400);
    expect((await POST(post("m=42"))).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
});
