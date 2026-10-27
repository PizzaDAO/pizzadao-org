// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/reengage/run", () => ({
  runReengage: vi.fn(async (o: unknown) => ({ week: "2026-W44", dryRun: true, opts: o })),
}));

import { GET } from "./route";
import { runReengage } from "@/app/lib/reengage/run";

const req = (path: string, auth?: string) =>
  new NextRequest(`https://app.pizzadao.org${path}`, { headers: auth ? { authorization: auth } : {} });

let saved: string | undefined;
beforeEach(() => { vi.clearAllMocks(); saved = process.env.CRON_SECRET; process.env.CRON_SECRET = "cron-secret"; });
afterEach(() => { if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved; });

describe("/api/cron/reengage", () => {
  it("401s without the bearer token and does no work", async () => {
    expect((await GET(req("/api/cron/reengage"))).status).toBe(401);
    expect(runReengage).not.toHaveBeenCalled();
  });
  it("runs with the token and passes dry/limit through", async () => {
    const res = await GET(req("/api/cron/reengage?dry=1&limit=5", "Bearer cron-secret"));
    expect(res.status).toBe(200);
    expect(runReengage).toHaveBeenCalledWith({ dryRun: true, limit: 5 });
  });
});
