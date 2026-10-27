// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => ({
  mission: { findMany: vi.fn() },
  missionCompletion: { findMany: vi.fn() },
  transaction: { findMany: vi.fn() },
  memberProfileExtras: { findMany: vi.fn(), upsert: vi.fn() },
  reengageEmailSend: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@/app/lib/db", () => ({ prisma: db }));
vi.mock("@/app/lib/sheets/member-repository", () => ({ getSheetData: vi.fn() }));
vi.mock("@/app/lib/crew-mappings", () => ({ getCrewMappings: vi.fn(async () => ({ crews: [] })) }));

import { getSheetData } from "@/app/lib/sheets/member-repository";
import { signUnsubscribe, verifyUnsubscribe, unsubscribePostUrl } from "./unsub-sig";
import { computeDigest, type DigestInput } from "./digest";
import { renderDigestEmail } from "./render";
import { weekKey, memberEmail, runReengage } from "./run";
import { sendEmail } from "./mailer";

const NOW = new Date("2026-10-27T16:00:00Z"); // a Tuesday
const missions = [
  { id: 1, level: 1, index: 0, title: "Join Discord", levelTitle: "Trainee" },
  { id: 2, level: 1, index: 1, title: "Say hi", levelTitle: "Trainee" },
  { id: 3, level: 2, index: 0, title: "Invite a friend", levelTitle: "Cook" },
];
const base = (over: Partial<DigestInput> = {}): DigestInput => ({
  memberId: "m1", name: "Tony", locale: "en", timezone: "America/New_York", crewNames: [],
  missions, approvedIds: new Set(), pendingIds: new Set(), paidLevels: new Set(), crews: [], now: NOW, ...over,
});

let savedSecret: string | undefined;
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.SESSION_SECRET;
  saved = { e: process.env.REENGAGE_EMAIL_ENABLED, k: process.env.RESEND_API_KEY };
  process.env.SESSION_SECRET = "test-secret";
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = savedSecret;
  if (saved.e === undefined) delete process.env.REENGAGE_EMAIL_ENABLED; else process.env.REENGAGE_EMAIL_ENABLED = saved.e;
  if (saved.k === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = saved.k;
  vi.unstubAllGlobals();
});

describe("unsubscribe signature", () => {
  it("verifies its own signature and rejects tampering", () => {
    const sig = signUnsubscribe("m1")!;
    expect(verifyUnsubscribe("m1", sig)).toBe(true);
    expect(verifyUnsubscribe("m2", sig)).toBe(false);
    expect(verifyUnsubscribe("m1", sig + "x")).toBe(false);
    expect(verifyUnsubscribe("m1", undefined)).toBe(false);
  });
  it("fails closed without SESSION_SECRET", () => {
    delete process.env.SESSION_SECRET;
    expect(signUnsubscribe("m1")).toBeNull();
    expect(verifyUnsubscribe("m1", "anything")).toBe(false);
    expect(unsubscribePostUrl("m1")).toBeNull();
  });
});

describe("computeDigest", () => {
  it("points at the first open mission and counts what is left", () => {
    const d = computeDigest(base({ approvedIds: new Set([1]) }));
    expect(d.level).toBe(1);
    expect(d.nextMission).toEqual({ level: 1, title: "Say hi" });
    expect(d.remaining).toBe(1);
    expect(d.nextLevel).toBe(2);
    expect(d.nextLevelTitle).toBe("Cook");
  });
  it("skips a mission already awaiting review", () => {
    const d = computeDigest(base({ approvedIds: new Set([1]), pendingIds: new Set([2]) }));
    expect(d.nextMission).toBeNull();
    expect(d.remaining).toBe(1);
  });
  it("reports allDone and no progress line when everything is approved", () => {
    const d = computeDigest(base({ approvedIds: new Set([1, 2, 3]) }));
    expect(d.allDone).toBe(true);
    expect(d.nextLevel).toBeNull();
  });
  it("includes only crew calls within 7 days", () => {
    const crews = [
      { id: "ops", label: "Ops", turtles: [], callTime: "Wednesdays 3pm ET" },
      { id: "art", label: "Art", turtles: [], callTime: "Mondays 3pm ET" },
    ];
    const d = computeDigest(base({ crewNames: ["ops", "Art", "ops"], crews }));
    expect(d.calls.map((c) => c.crew)).toEqual(["Ops", "Art"]);
    const far = computeDigest(base({ crewNames: ["ops"], crews, now: new Date("2026-10-27T20:30:00Z") }));
    expect(far.calls).toHaveLength(1);
  });
});

describe("renderDigestEmail", () => {
  it.each(["en", "es", "fr"] as const)("renders %s with mission, progress, unsubscribe and escaping", (locale) => {
    const d = computeDigest(base({ locale, name: "<b>Tony</b>", approvedIds: new Set([1]) }));
    const r = renderDigestEmail(d, { siteUrl: "https://pizzadao.org", unsubscribeUrl: "https://pizzadao.org/email/unsubscribe?m=m1&s=x" });
    expect(r.subject).toContain("Say hi");
    expect(r.html).toContain('lang="' + locale + '"');
    expect(r.html).toContain("&lt;b&gt;Tony&lt;/b&gt;");
    expect(r.html).not.toContain("<b>Tony</b>");
    expect(r.html).toContain("/email/unsubscribe");
    expect(r.text).toContain("https://pizzadao.org/missions");
    expect(r.text).not.toMatch(/\{[a-z]+/i);
  });
  it("uses the default subject when there is no open mission", () => {
    const d = computeDigest(base({ approvedIds: new Set([1, 2, 3]) }));
    expect(renderDigestEmail(d, { siteUrl: "https://pizzadao.org" }).subject).toBe("Your week at PizzaDAO");
  });
});

describe("helpers", () => {
  it("weekKey is ISO and stable across the week", () => {
    expect(weekKey(new Date("2026-10-27T16:00:00Z"))).toBe("2026-W44");
    expect(weekKey(new Date("2026-10-26T00:00:00Z"))).toBe("2026-W44");
    expect(weekKey(new Date("2026-11-01T23:59:00Z"))).toBe("2026-W44");
    expect(weekKey(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
  });
  it("memberEmail finds the column case-insensitively and validates", () => {
    expect(memberEmail({ discordId: "1", Email: " a@b.co " })).toBe("a@b.co");
    expect(memberEmail({ discordId: "1", "E-mail": "nope" })).toBeNull();
    expect(memberEmail({ discordId: "1", Name: "x" })).toBeNull();
  });
});

function sheet(rows: Record<string, string>[]) {
  vi.mocked(getSheetData).mockResolvedValue({ rows } as never);
}
function setupDb({ sent = [] as string[], optedOut = [] as string[] } = {}) {
  db.mission.findMany.mockResolvedValue(missions);
  db.missionCompletion.findMany.mockResolvedValue([]);
  db.transaction.findMany.mockResolvedValue([]);
  db.memberProfileExtras.findMany.mockImplementation(async (a: { where: { reengageEmailOptOut?: boolean } }) =>
    a.where.reengageEmailOptOut ? optedOut.map((memberId) => ({ memberId })) : [],
  );
  db.reengageEmailSend.findMany.mockResolvedValue(sent.map((memberId) => ({ memberId })));
  db.reengageEmailSend.createMany.mockResolvedValue({ count: 1 });
}
const rows = [
  { ID: "1", discordId: "d1", Name: "A", Email: "a@x.io", Crews: "" },
  { ID: "2", discordId: "d2", Name: "B", Email: "b@x.io", Crews: "" },
  { ID: "3", discordId: "d3", Name: "C", Email: "", Crews: "" },
  { ID: "4", discordId: "d4", Name: "D", Email: "d@x.io", Crews: "" },
];

describe("runReengage", () => {
  it("is a dry run (no writes, no sends) while REENGAGE_EMAIL_ENABLED is off", async () => {
    delete process.env.REENGAGE_EMAIL_ENABLED;
    sheet(rows); setupDb();
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const r = await runReengage({ now: NOW });
    expect(r).toMatchObject({ dryRun: true, enabled: false, eligible: 3, batch: 3, sent: 0 });
    expect(db.reengageEmailSend.createMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("excludes opted-out members and members already handled this week, and honors the batch limit", async () => {
    process.env.REENGAGE_EMAIL_ENABLED = "true"; process.env.RESEND_API_KEY = "k";
    sheet(rows); setupDb({ sent: ["1"], optedOut: ["2"] });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await runReengage({ now: NOW, limit: 5 });
    expect(r).toMatchObject({ withEmail: 3, optedOut: 1, eligible: 1, sent: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }];
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(["d@x.io"]);
    expect(body.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/.+\/api\/email\/unsubscribe\?m=4&s=.+>$/);
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(init.headers["Idempotency-Key"]).toBe("reengage-4-2026-W44");
  });

  it("limits the batch and does not send when the claim was already taken", async () => {
    process.env.REENGAGE_EMAIL_ENABLED = "true"; process.env.RESEND_API_KEY = "k";
    sheet(rows); setupDb();
    db.reengageEmailSend.createMany.mockResolvedValue({ count: 0 });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const r = await runReengage({ now: NOW, limit: 2 });
    expect(r.batch).toBe(2);
    expect(r.alreadyClaimed).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks a provider failure FAILED and never throws", async () => {
    process.env.REENGAGE_EMAIL_ENABLED = "true"; process.env.RESEND_API_KEY = "k";
    sheet([rows[0]]); setupDb();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    const r = await runReengage({ now: NOW });
    expect(r).toMatchObject({ sent: 0, failed: 1 });
    expect(db.reengageEmailSend.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "FAILED" } }));
  });

  it("does not send mail it cannot sign an unsubscribe link for", async () => {
    process.env.REENGAGE_EMAIL_ENABLED = "true"; process.env.RESEND_API_KEY = "k";
    delete process.env.SESSION_SECRET;
    sheet([rows[0]]); setupDb();
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const r = await runReengage({ now: NOW });
    expect(r.failed).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explicit dryRun wins even when enabled", async () => {
    process.env.REENGAGE_EMAIL_ENABLED = "true";
    sheet(rows); setupDb();
    const r = await runReengage({ now: NOW, dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(db.reengageEmailSend.createMany).not.toHaveBeenCalled();
  });
});

describe("sendEmail", () => {
  it("fails without an API key and never calls fetch", async () => {
    const f = vi.fn();
    expect(await sendEmail({ to: "a@b.c", subject: "s", html: "h", text: "t" }, {} as NodeJS.ProcessEnv, f as never)).toEqual({ ok: false, reason: "no_api_key" });
    expect(f).not.toHaveBeenCalled();
  });
});
