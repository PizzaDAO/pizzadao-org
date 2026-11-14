// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { fakeSettings } from "@/app/lib/newsletter/fake-db";
import { emptySections } from "@/app/lib/newsletter/sections";
import type { PostFilter } from "@/app/lib/calls/post-filters";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  session: { ok: true as boolean, discordId: "admin1" },
  isAdmin: true,
  holdsRole: false,
  settings: {} as Record<string, unknown>,
  row: null as Row | null,
  events: [] as Array<{ action: string; actor?: string }>,
  eligible: new Set<number>(),
  calls: [] as Row[],
  filter: { excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: [] } as PostFilter | "throw",
  draftHook: null as null | (() => void),
}));

vi.mock("@/app/lib/auth-guards", () => ({
  requireAdmin: vi.fn(async () => {
    if (!h.session.ok) return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
    if (!h.isAdmin) return { ok: false, response: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
    return { ok: true, session: { discordId: h.session.discordId } };
  }),
  requireSession: vi.fn(async () => (h.session.ok ? { ok: true, session: { discordId: h.session.discordId } } : { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) })),
  hasAnyRoleSafe: vi.fn(async () => h.holdsRole),
  isAdminDiscordId: vi.fn(async () => h.isAdmin),
}));
vi.mock("@/app/lib/settings", async () => {
  const { fakeSettings: fs } = await import("@/app/lib/newsletter/fake-db");
  return { loadSettings: async () => fs(h.settings) };
});
vi.mock("@/app/lib/calls/post-filters", async (orig) => ({
  ...(await orig<typeof import("@/app/lib/calls/post-filters")>()),
  loadPostFilter: async () => {
    if (h.filter === "throw") throw new Error("unreadable");
    return h.filter;
  },
}));
vi.mock("@/app/lib/calls/imported", async (orig) => ({ ...(await orig<typeof import("@/app/lib/calls/imported")>()), importedAllowed: async () => false }));
vi.mock("@/app/lib/newsletter/sources/spotlight", async (orig) => ({
  ...(await orig<typeof import("@/app/lib/newsletter/sources/spotlight")>()),
  loadMemberCandidates: async () => ({ rows: [], candidates: [{ id: 5, name: "Nominee", city: "", status: "SHORTLISTED" }] }),
  loadMemberSpotlight: async (id: number) => (h.eligible.has(id) ? { id, nomineeName: "Nominee", city: "Town", pitch: "Pitch.", links: [], photoUrl: null, consent: true, status: "SHORTLISTED" } : null),
}));
vi.mock("@/app/lib/newsletter/draft", async (orig) => ({
  ...(await orig<typeof import("@/app/lib/newsletter/draft")>()),
  draftWithModelEnabled: () => true,
  writeDraftText: async (sections: unknown) => {
    h.draftHook?.();
    return { sections, subject: "Model subject", preheader: "", model: "m" };
  },
}));
vi.mock("@/app/lib/db", () => {
  const issue = {
    findUnique: async () => (h.row ? { ...h.row } : null),
    findUniqueOrThrow: async () => ({ ...h.row }),
    findMany: async () => [],
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const r = h.row;
      if (!r || r.id !== where.id) return { count: 0 };
      if (where.updatedAt && (where.updatedAt as Date).getTime() !== (r.updatedAt as Date).getTime()) return { count: 0 };
      if (typeof where.status === "string" && r.status !== where.status) return { count: 0 };
      if (where.status && typeof where.status === "object" && !(where.status as { in: string[] }).in.includes(r.status as string)) return { count: 0 };
      Object.assign(r, data, { updatedAt: new Date((r.updatedAt as Date).getTime() + 1000) });
      return { count: 1 };
    },
  };
  const event = {
    create: async ({ data }: { data: { action: string; actor?: string } }) => void h.events.push({ action: data.action, actor: data.actor }),
    findMany: async () => h.events.map((e) => ({ action: e.action, actor: e.actor ?? null, createdAt: new Date("2026-12-17") })),
    count: async () => 0,
  };
  return { prisma: { newsletterIssue: issue, newsletterIssueEvent: event, callRecording: { findMany: async () => h.calls } } };
});

import { GET as listGET } from "./route";
import { GET as oneGET, PATCH } from "./[id]/route";
import { POST as approve } from "./[id]/approve/route";
import { POST as unapprove } from "./[id]/unapprove/route";
import { POST as redraft } from "./[id]/redraft/route";
import { POST as testSend } from "./[id]/test-send/route";

const ctx = { params: Promise.resolve({ id: "i1" }) };
const T0 = "2026-12-17T00:00:00.000Z";
const req = (body?: unknown) => new Request("https://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ver = () => ({ updatedAt: (h.row!.updatedAt as Date).toISOString() });

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
    approvedBy: "secret-approver-id",
    approvedAt: null,
    updatedAt: new Date(T0),
    ...o,
  };
}

beforeEach(() => {
  h.session = { ok: true, discordId: "admin1" };
  h.isAdmin = true;
  h.holdsRole = false;
  h.settings = {};
  h.row = makeRow();
  h.events = [];
  h.eligible = new Set();
  h.calls = [];
  h.filter = { excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: [] };
  h.draftHook = null;
});

describe("editor API auth", () => {
  it("rejects anonymous requests with 401 on every route", async () => {
    h.session = { ok: false, discordId: "" };
    for (const res of [
      await listGET(),
      await oneGET(new Request("https://x"), ctx),
      await PATCH(req({ subject: "x", ...ver() }), ctx),
      await approve(req(ver()), ctx),
      await unapprove(req(), ctx),
      await redraft(req(ver()), ctx),
      await testSend(req(), ctx),
    ]) {
      expect(res.status).toBe(401);
    }
    expect(h.events).toEqual([]);
  });

  it("rejects people who are neither admin nor approver with 403", async () => {
    h.isAdmin = false;
    for (const res of [await listGET(), await oneGET(new Request("https://x"), ctx), await PATCH(req({ subject: "x", ...ver() }), ctx), await unapprove(req(), ctx), await testSend(req(), ctx), await redraft(req(ver()), ctx)]) {
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
    expect((await PATCH(req({ approvedBy: "me", ...ver() }), ctx)).status).toBe(400);
    const s = emptySections();
    s.partner.website = "javascript:alert(1)";
    expect((await PATCH(req({ sections: s, ...ver() }), ctx)).status).toBe(400);
  });
});

describe("approvers who are not admins", () => {
  beforeEach(() => {
    h.isAdmin = false;
    h.holdsRole = true;
    h.settings = { "newsletter.approverRoleIds": ["111111111111111111"] };
    h.events = [{ action: "generate", actor: "someone" }];
  });

  it("get a read-only view without pick lists or actor ids", async () => {
    const res = await oneGET(new Request("https://x"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.readOnly).toBe(true);
    expect(body.canApprove).toBe(true);
    expect(body.candidates).toEqual({ members: [], cities: [] });
    expect(body.audit.every((a: { actor: unknown }) => a.actor === null)).toBe(true);
    expect(body.issue.approvedBy).toBeNull();
    expect(JSON.stringify(body)).not.toContain("secret-approver-id");
  });

  it("can approve and unapprove but not edit, redraft, test-send or list", async () => {
    expect((await PATCH(req({ subject: "x", ...ver() }), ctx)).status).toBe(403);
    expect((await redraft(req(ver()), ctx)).status).toBe(403);
    expect((await testSend(req(), ctx)).status).toBe(403);
    expect((await listGET()).status).toBe(403);
    expect((await approve(req(ver()), ctx)).status).toBe(200);
    expect(h.row!.status).toBe("approved");
    expect((await unapprove(req(), ctx)).status).toBe(200);
    expect(h.row!.status).toBe("draft");
  });

  it("an admin without the approver role sees the full editor view but can't approve", async () => {
    h.isAdmin = true;
    h.holdsRole = false;
    const view = await (await oneGET(new Request("https://x"), ctx)).json();
    expect(view.readOnly).toBe(false);
    expect(view.canApprove).toBe(false);
    expect((await approve(req(ver()), ctx)).status).toBe(403);
  });
});

describe("approve / edit lifecycle", () => {
  it("a non-approver cannot approve", async () => {
    h.isAdmin = false;
    h.holdsRole = false;
    h.settings = { "newsletter.approverRoleIds": ["111111111111111111"] };
    expect((await approve(req(ver()), ctx)).status).toBe(403);
    expect(h.row!.status).toBe("draft");
  });

  it("an approver approves and the hash is stored; the preview and blockers are returned", async () => {
    const res = await approve(req(ver()), ctx);
    expect(res.status).toBe(200);
    expect(h.row).toMatchObject({ status: "approved", approvedBy: "admin1" });
    expect(h.row!.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const body = await res.json();
    expect(body.issue.status).toBe("approved");
    expect(body.preview.html).toContain("Hello.");
    expect(h.events.map((e) => e.action)).toContain("approve");
  });

  it("any edit after approval returns the issue to draft and clears the hash", async () => {
    await approve(req(ver()), ctx);
    const res = await PATCH(req({ subject: "Changed after approval", ...ver() }), ctx);
    expect(res.status).toBe(200);
    expect(h.row).toMatchObject({ status: "draft", approvedBy: null, approvedAt: null, contentHash: null, subject: "Changed after approval" });
  });

  it("unapprove clears the approval; approving a non-draft is refused", async () => {
    await approve(req(ver()), ctx);
    expect((await approve(req(ver()), ctx)).status).toBe(409);
    expect((await unapprove(req(), ctx)).status).toBe(200);
    expect(h.row).toMatchObject({ status: "draft", contentHash: null });
    expect((await unapprove(req(), ctx)).status).toBe(409);
  });

  it("sent and cancelled issues can't be edited", async () => {
    h.row = makeRow({ status: "sent" });
    expect((await PATCH(req({ subject: "x", ...ver() }), ctx)).status).toBe(409);
  });
});

describe("optimistic lock", () => {
  it("approve refuses a stale or missing version (409 / 400) and changes nothing", async () => {
    expect((await approve(req({ updatedAt: "2026-12-16T00:00:00.000Z" }), ctx)).status).toBe(409);
    expect((await approve(req(), ctx)).status).toBe(400);
    expect(h.row!.status).toBe("draft");
  });

  it("PATCH refuses a stale version", async () => {
    const res = await PATCH(req({ subject: "Mine", updatedAt: "2026-12-16T00:00:00.000Z" }), ctx);
    expect(res.status).toBe(409);
    expect(h.row!.subject).toBe("Subject");
  });

  it("an edit made after the approver loaded the page blocks the approval", async () => {
    const seen = ver();
    expect((await PATCH(req({ subject: "Edited meanwhile", ...seen }), ctx)).status).toBe(200);
    expect((await approve(req(seen), ctx)).status).toBe(409);
    expect(h.row!.status).toBe("draft");
  });

  it("redraft doesn't overwrite an edit made during the model call", async () => {
    const seen = ver();
    h.draftHook = () => {
      h.row!.subject = "Edited during the model call";
      h.row!.updatedAt = new Date((h.row!.updatedAt as Date).getTime() + 5000);
    };
    const res = await redraft(req(seen), ctx);
    expect(res.status).toBe(409);
    expect(h.row!.subject).toBe("Edited during the model call");
    // And a stale version up front is refused before any model call.
    h.draftHook = () => {
      throw new Error("model must not be called");
    };
    expect((await redraft(req(seen), ctx)).status).toBe(409);
  });

  it("redraft with the current version saves the model text", async () => {
    const res = await redraft(req(ver()), ctx);
    expect(res.status).toBe(200);
    expect(h.row!.subject).toBe("Model subject");
  });
});

describe("Member Spotlight eligibility and sources", () => {
  const withMember = (id: number | null, name = "Nominee") => {
    const s = emptySections();
    s.intro = "Hello.";
    s.member = { enabled: true, submissionId: id, name, city: "", blurb: "Text.", links: [], photoUrl: "" };
    return s;
  };

  it("refuses an ineligible submission id sent through sections, and free-form entries", async () => {
    expect((await PATCH(req({ sections: withMember(7), ...ver() }), ctx)).status).toBe(400);
    expect((await PATCH(req({ sections: withMember(null), ...ver() }), ctx)).status).toBe(400);
    expect(h.row!.subject).toBe("Subject");
  });

  it("accepts an eligible one and records it in sources for the used-spotlight check", async () => {
    h.eligible.add(7);
    const res = await PATCH(req({ sections: withMember(7), ...ver() }), ctx);
    expect(res.status).toBe(200);
    expect((h.row!.sources as { spotlightIds: number[] }).spotlightIds).toEqual([7]);
  });

  it("picking by id records the id too, and removing the section clears it", async () => {
    h.eligible.add(5);
    expect((await PATCH(req({ pickMember: 5, ...ver() }), ctx)).status).toBe(200);
    expect((h.row!.sources as { spotlightIds: number[] }).spotlightIds).toEqual([5]);
    const off = emptySections();
    off.intro = "Hello.";
    expect((await PATCH(req({ sections: off, ...ver() }), ctx)).status).toBe(200);
    expect((h.row!.sources as { spotlightIds: number[] }).spotlightIds).toEqual([]);
  });
});

describe("approval re-checks the privacy rules", () => {
  const callsRow = (extra: Row = {}) => {
    const s = emptySections();
    s.intro = "Hello.";
    s.calls = { enabled: true, intro: "", crews: [{ id: "ops", label: "Ops Crew", summary: "Reviewed the backlog.", bullets: ["Reviewed."], shipped: [], url: "", included: true }] };
    return makeRow({ sections: s, sources: { callIds: ["c1"] }, ...extra });
  };
  const rec = (o: Row = {}) => ({ id: "c1", status: "PUBLISHED", source: "DISCORD", crewId: "ops", crewLabel: "Ops Crew", ...o });

  it("approves when nothing changed", async () => {
    h.row = callsRow();
    h.calls = [rec()];
    expect((await approve(req(ver()), ctx)).status).toBe(200);
  });

  it("refuses when a call was unpublished, redactions got newer, the crew was excluded or a term got blocked", async () => {
    h.row = callsRow();
    h.calls = [rec({ status: "REVIEW" })];
    let res = await approve(req(ver()), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/no longer published/);

    h.calls = [rec({ redactionsUpdatedAt: new Date("2026-12-16"), summaryGeneratedAt: new Date("2026-12-10") })];
    expect((await approve(req(ver()), ctx)).status).toBe(409);

    h.calls = [rec()];
    h.filter = { excludedCrewIds: ["ops"], excludedCrewLabelTerms: [], blockedTerms: [] };
    expect((await approve(req(ver()), ctx)).status).toBe(409);

    h.filter = { excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: ["backlog"] };
    res = await approve(req(ver()), ctx);
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).not.toContain("backlog");
    expect(h.row!.status).toBe("draft");
  });

  it("fails closed when the post filter can't be read", async () => {
    h.row = callsRow();
    h.calls = [rec()];
    h.filter = "throw";
    expect((await approve(req(ver()), ctx)).status).toBe(503);
    expect(h.row!.status).toBe("draft");
  });
});
