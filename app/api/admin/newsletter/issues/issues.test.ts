// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { fakeSettings } from "@/app/lib/newsletter/fake-db";
import { emptySections } from "@/app/lib/newsletter/sections";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  admin: { ok: true as boolean, discordId: "admin1" },
  session: { ok: true as boolean, discordId: "admin1" },
  approver: true,
  row: null as Row | null,
  events: [] as Array<{ action: string }>,
}));

vi.mock("@/app/lib/auth-guards", () => ({
  requireAdmin: vi.fn(async () => (h.admin.ok ? { ok: true, session: { discordId: h.admin.discordId } } : { ok: false, response: NextResponse.json({ error: "Admin access required" }, { status: h.admin.discordId ? 403 : 401 }) })),
  requireSession: vi.fn(async () => (h.session.ok ? { ok: true, session: { discordId: h.session.discordId } } : { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) })),
  hasAnyRoleSafe: vi.fn(async () => h.approver),
  isAdminDiscordId: vi.fn(async () => h.approver),
}));
vi.mock("@/app/lib/settings", () => ({ loadSettings: async () => fakeSettings() }));
vi.mock("@/app/lib/newsletter/sources/spotlight", async (orig) => ({ ...(await orig<typeof import("@/app/lib/newsletter/sources/spotlight")>()), loadMemberCandidates: async () => ({ rows: [], candidates: [] }) }));
vi.mock("@/app/lib/db", () => {
  const issue = {
    findUnique: async () => (h.row ? { ...h.row } : null),
    findUniqueOrThrow: async () => ({ ...h.row }),
    findMany: async () => [],
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const r = h.row;
      if (!r || r.id !== where.id) return { count: 0 };
      if (where.status && typeof where.status === "string" && r.status !== where.status) return { count: 0 };
      if (where.status && typeof where.status === "object" && !(where.status as { in: string[] }).in.includes(r.status as string)) return { count: 0 };
      Object.assign(r, data, { updatedAt: new Date(Date.now() + 1) });
      return { count: 1 };
    },
  };
  const event = { create: async ({ data }: { data: { action: string } }) => void h.events.push({ action: data.action }), findMany: async () => [], count: async () => 0 };
  return { prisma: { newsletterIssue: issue, newsletterIssueEvent: event } };
});

import { GET as listGET } from "./route";
import { GET as oneGET, PATCH } from "./[id]/route";
import { POST as approve } from "./[id]/approve/route";
import { POST as unapprove } from "./[id]/unapprove/route";
import { POST as testSend } from "./[id]/test-send/route";

const ctx = { params: Promise.resolve({ id: "i1" }) };
const req = (body?: unknown) => new Request("https://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

function makeRow(o: Row = {}): Row {
  const s = emptySections();
  s.intro = "Hello.";
  return {
    id: "i1",
    slug: "2026-12",
    status: "draft",
    issueDate: new Date("2026-12-22T12:00:00Z"),
    periodStart: new Date("2026-11-22T00:00:00Z"),
    periodEnd: new Date("2026-12-17T00:00:00Z"),
    subject: "Subject",
    preheader: "",
    sections: s,
    sources: null,
    xSpaceUrl: null,
    model: null,
    sponsorNotified: false,
    contentHash: null,
    approvedBy: null,
    approvedAt: null,
    updatedAt: new Date("2026-12-17T00:00:00Z"),
    ...o,
  };
}

beforeEach(() => {
  h.admin = { ok: true, discordId: "admin1" };
  h.session = { ok: true, discordId: "admin1" };
  h.approver = true;
  h.row = makeRow();
  h.events = [];
});

describe("editor API auth", () => {
  it("rejects anonymous requests with 401 on every route", async () => {
    h.admin = { ok: false, discordId: "" };
    h.session = { ok: false, discordId: "" };
    for (const res of [
      await listGET(),
      await oneGET(new Request("https://x"), ctx),
      await PATCH(req({ subject: "x" }), ctx),
      await approve(req(), ctx),
      await unapprove(req(), ctx),
      await testSend(req(), ctx),
    ]) {
      expect(res.status).toBe(401);
    }
    expect(h.events).toEqual([]);
  });

  it("rejects non-admins with 403", async () => {
    h.admin = { ok: false, discordId: "member1" };
    for (const res of [await listGET(), await oneGET(new Request("https://x"), ctx), await PATCH(req({ subject: "x" }), ctx), await unapprove(req(), ctx), await testSend(req(), ctx)]) {
      expect(res.status).toBe(403);
    }
    expect(h.row!.subject).toBe("Subject");
  });

  it("test send has no recipient parameter and refuses without a configured sender", async () => {
    const res = await testSend(req({ to: "someone@example.org" }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/sender/i);
  });

  it("rejects unknown fields and bad links in edits", async () => {
    expect((await PATCH(req({ approvedBy: "me" }), ctx)).status).toBe(400);
    const s = emptySections();
    s.partner.website = "javascript:alert(1)";
    expect((await PATCH(req({ sections: s }), ctx)).status).toBe(400);
  });
});

describe("approve / edit lifecycle", () => {
  it("a non-approver cannot approve", async () => {
    h.approver = false;
    const res = await approve(req(), ctx);
    expect(res.status).toBe(403);
    expect(h.row!.status).toBe("draft");
  });

  it("an approver approves and the hash is stored; the preview and blockers are returned", async () => {
    const res = await approve(req(), ctx);
    expect(res.status).toBe(200);
    expect(h.row).toMatchObject({ status: "approved", approvedBy: "admin1" });
    expect(h.row!.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const body = await res.json();
    expect(body.issue.status).toBe("approved");
    expect(body.preview.html).toContain("Hello.");
    expect(h.events.map((e) => e.action)).toContain("approve");
  });

  it("any edit after approval returns the issue to draft and clears the hash", async () => {
    await approve(req(), ctx);
    expect(h.row!.status).toBe("approved");
    const res = await PATCH(req({ subject: "Changed after approval" }), ctx);
    expect(res.status).toBe(200);
    expect(h.row).toMatchObject({ status: "draft", approvedBy: null, approvedAt: null, contentHash: null, subject: "Changed after approval" });
  });

  it("unapprove clears the approval; approving a non-draft is refused", async () => {
    await approve(req(), ctx);
    expect((await approve(req(), ctx)).status).toBe(409);
    expect((await unapprove(req(), ctx)).status).toBe(200);
    expect(h.row).toMatchObject({ status: "draft", contentHash: null });
    expect((await unapprove(req(), ctx)).status).toBe(409);
  });

  it("sent and cancelled issues can't be edited", async () => {
    h.row = makeRow({ status: "sent" });
    expect((await PATCH(req({ subject: "x" }), ctx)).status).toBe(409);
  });
});
