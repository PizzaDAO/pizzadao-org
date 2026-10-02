import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("@/app/lib/discord", () => ({ hasAnyRole: vi.fn() }));
vi.mock("@/app/lib/roster-audit", () => ({ runRosterAudit: vi.fn() }));
vi.mock("@/app/lib/roster-writeback", async () => {
  class RosterWritebackError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  }
  return { updateMemberCrews: vi.fn(), RosterWritebackError };
});

import { GET, POST } from "./route";
import { getSession } from "@/app/lib/session";
import { hasAnyRole } from "@/app/lib/discord";
import { runRosterAudit } from "@/app/lib/roster-audit";
import { updateMemberCrews, RosterWritebackError } from "@/app/lib/roster-writeback";

const mSession = vi.mocked(getSession);
const mRole = vi.mocked(hasAnyRole);
const mAudit = vi.mocked(runRosterAudit);
const mUpdate = vi.mocked(updateMemberCrews);

function post(body: unknown, contentType = "application/json") {
  return new NextRequest("http://localhost/api/crew/roster-audit", {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const admin = () => {
  mSession.mockResolvedValue({ discordId: "123", createdAt: 0 });
  mRole.mockResolvedValue(true);
};

beforeEach(() => vi.clearAllMocks());

describe("GET /api/crew/roster-audit", () => {
  it("401s without a session and 403s for non-admins", async () => {
    mSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    mSession.mockResolvedValue({ discordId: "123", createdAt: 0 });
    mRole.mockResolvedValue(false);
    expect((await GET()).status).toBe(403);
    expect(mAudit).not.toHaveBeenCalled();
  });

  it("returns the audit for admins with no-store caching", async () => {
    admin();
    mAudit.mockResolvedValue({ missing: [], inactive: [], healthyCount: 1, untrackedCount: 0, skippedMembers: 0 });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mRole).toHaveBeenCalledWith("123", expect.any(Array));
  });
});

describe("POST /api/crew/roster-audit", () => {
  it("rejects non-admins before doing anything", async () => {
    mSession.mockResolvedValue(null);
    expect((await POST(post({ memberId: "1", crewId: "ops", action: "add", mode: "apply" }))).status).toBe(401);
    mSession.mockResolvedValue({ discordId: "123", createdAt: 0 });
    mRole.mockResolvedValue(false);
    expect((await POST(post({ memberId: "1", crewId: "ops", action: "add", mode: "apply" }))).status).toBe(403);
    expect(mUpdate).not.toHaveBeenCalled();
  });

  it("defaults to dry-run", async () => {
    admin();
    mUpdate.mockResolvedValue({ mode: "dry-run", applied: false, changed: true, range: "r", before: "", after: "Ops", crews: ["Ops"] });
    const res = await POST(post({ memberId: "1", crewId: "ops", action: "add" }));
    expect(res.status).toBe(200);
    expect(mUpdate).toHaveBeenCalledWith({ memberId: "1", crewId: "ops", action: "add", mode: "dry-run", expectedBefore: undefined });
  });

  it("validates the body", async () => {
    admin();
    expect((await POST(post("not json"))).status).toBe(400);
    expect((await POST(post({ memberId: "1", crewId: "ops", action: "add" }, "text/plain"))).status).toBe(415);
    expect((await POST(post({ memberId: 1, crewId: "ops", action: "add" }))).status).toBe(400);
    expect((await POST(post({ memberId: "1", crewId: "ops", action: "delete" }))).status).toBe(400);
    expect((await POST(post({ memberId: "1", crewId: "ops", action: "add", mode: "force" }))).status).toBe(400);
    expect((await POST(post({ memberId: "1", crewId: "ops", action: "add", expectedBefore: 5 }))).status).toBe(400);
    expect(mUpdate).not.toHaveBeenCalled();
  });

  it("maps write-back errors to their status", async () => {
    admin();
    mUpdate.mockRejectedValue(new RosterWritebackError("changed", 409));
    const res = await POST(post({ memberId: "1", crewId: "ops", action: "add", mode: "apply", expectedBefore: "" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "changed" });
  });
});
