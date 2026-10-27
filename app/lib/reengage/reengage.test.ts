// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => ({
  mission: { findMany: vi.fn() },
  missionCompletion: { findMany: vi.fn() },
  transaction: { findMany: vi.fn() },
  memberProfileExtras: { findMany: vi.fn(), upsert: vi.fn() },
  reengageEmailSend: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), groupBy: vi.fn() },
}));
vi.mock("@/app/lib/db", () => ({ prisma: db }));
vi.mock("@/app/lib/sheets/member-repository", () => ({ getSheetData: vi.fn() }));
vi.mock("@/app/lib/crew-mappings", () => ({ getCrewMappings: vi.fn(async () => ({ crews: [] })) }));

import { getSheetData } from "@/app/lib/sheets/member-repository";
import { signUnsubscribe, verifyUnsubscribe, unsubscribePostUrl, signConfirm, verifyConfirm } from "./unsub-sig";
import { computeDigest, type DigestInput } from "./digest";
import { renderDigestEmail } from "./render";
import { weekKey, runReengage } from "./run";
import { sendEmail, __setMinInterval, oneLine } from "./mailer";

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
  saved = { e: process.env.REENGAGE_EMAIL_ENABLED, k: process.env.RESEND_API_KEY, p: process.env.REENGAGE_POSTAL_ADDRESS, u: process.env.UNSUBSCRIBE_SECRET };
  process.env.SESSION_SECRET = "test-secret";
  delete process.env.UNSUBSCRIBE_SECRET;
  process.env.REENGAGE_POSTAL_ADDRESS = "PizzaDAO, 1 Slice St, New York, NY 10001";
  __setMinInterval(0);
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = savedSecret;
  if (saved.e === undefined) delete process.env.REENGAGE_EMAIL_ENABLED; else process.env.REENGAGE_EMAIL_ENABLED = saved.e;
  if (saved.k === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = saved.k;
  if (saved.p === undefined) delete process.env.REENGAGE_POSTAL_ADDRESS; else process.env.REENGAGE_POSTAL_ADDRESS = saved.p;
  if (saved.u === undefined) delete process.env.UNSUBSCRIBE_SECRET; else process.env.UNSUBSCRIBE_SECRET = saved.u;
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
  it("prefers UNSUBSCRIBE_SECRET over SESSION_SECRET", () => {
    const viaSession = signUnsubscribe("m1")!;
    process.env.UNSUBSCRIBE_SECRET = "dedicated";
    const dedicated = signUnsubscribe("m1")!;
    expect(dedicated).not.toBe(viaSession);
    expect(verifyUnsubscribe("m1", dedicated)).toBe(true);
    expect(verifyUnsubscribe("m1", viaSession)).toBe(false);
  });
  it("confirm tokens bind member, address (case-insensitively) and expiry", () => {
    const t = signConfirm("m1", "A@x.io", 1000)!;
    expect(verifyConfirm("m1", "a@x.io", t, 2000)).toBe(true);
    expect(verifyConfirm("m2", "a@x.io", t, 2000)).toBe(false);
    expect(verifyConfirm("m1", "other@x.io", t, 2000)).toBe(false);
    expect(verifyConfirm("m1", "a@x.io", t, 1000 + 8 * 24 * 3600 * 1000)).toBe(false);
    expect(verifyConfirm("m1", "a@x.io", "garbage", 2000)).toBe(false);
  });
  it("fails closed without a secret", () => {
    delete process.env.UNSUBSCRIBE_SECRET;
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
});

const sheetRows = [
  { ID: "1", discordId: "d1", Name: "A", Crews: "" },
  { ID: "2", discordId: "d2", Name: "B", Crews: "" },
  { ID: "4", discordId: "d4", Name: "D", Crews: "" },
  { ID: "5", discordId: "d5", Name: "E", Crews: "" },
];
function sheet() {
  vi.mocked(getSheetData).mockResolvedValue({
    rows: sheetRows,
    memberToIdx: new Map(sheetRows.map((r, i) => [r.ID, i])),
  } as never);
}
type Opt = { memberId: string; email: string };
function setupDb({ optedIn, sent = [] as string[], lastSent = {} as Record<string, number> }: { optedIn: Opt[]; sent?: string[]; lastSent?: Record<string, number> }) {
  db.mission.findMany.mockResolvedValue(missions);
  db.missionCompletion.findMany.mockResolvedValue([]);
  db.transaction.findMany.mockResolvedValue([]);
  db.memberProfileExtras.findMany.mockImplementation(async (a: { where: { reengageEmailOptIn?: boolean } }) =>
    a.where.reengageEmailOptIn ? optedIn : [],
  );
  db.reengageEmailSend.findMany.mockResolvedValue(sent.map((memberId) => ({ memberId })));
  db.reengageEmailSend.groupBy.mockResolvedValue(
    Object.entries(lastSent).map(([memberId, t]) => ({ memberId, _max: { sentAt: new Date(t) } })),
  );
  db.reengageEmailSend.createMany.mockResolvedValue({ count: 1 });
}
const optedIn: Opt[] = [
  { memberId: "1", email: "a@x.io" },
  { memberId: "2", email: "b@x.io" },
  { memberId: "4", email: "D@x.io" },
  { memberId: "5", email: "d@X.io" }, // same address as member 4, different case
];
const ok = () => vi.fn(async () => new Response(JSON.stringify({ id: "x" }), { status: 200 }));
const live = () => { process.env.REENGAGE_EMAIL_ENABLED = "true"; process.env.RESEND_API_KEY = "k"; };
const sentTo = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.map((c) => JSON.parse((c as unknown as [string, { body: string }])[1].body).to[0].toLowerCase());

describe("runReengage", () => {
  it("is a dry run (no writes, no sends) while REENGAGE_EMAIL_ENABLED is off", async () => {
    delete process.env.REENGAGE_EMAIL_ENABLED;
    sheet(); setupDb({ optedIn });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const r = await runReengage({ now: NOW });
    expect(r).toMatchObject({ dryRun: true, enabled: false, optedIn: 4, eligible: 3, duplicates: 1, batch: 3, sent: 0 });
    expect(db.reengageEmailSend.createMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips members handled this week, dedupes addresses, and sets unsubscribe headers and footer address", async () => {
    live();
    sheet(); setupDb({ optedIn, sent: ["1"] });
    const fetchMock = ok(); vi.stubGlobal("fetch", fetchMock);
    const r = await runReengage({ now: NOW, limit: 10 });
    expect(r).toMatchObject({ eligible: 2, duplicates: 1, sent: 2 });
    expect(sentTo(fetchMock)).toEqual(["b@x.io", "d@x.io"]);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }];
    const body = JSON.parse(init.body);
    expect(body.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/.+\/api\/email\/unsubscribe\?m=2&s=.+>$/);
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(body.html).toContain("1 Slice St");
    expect(body.text).toContain("1 Slice St");
    expect(init.headers["Idempotency-Key"]).toBe("reengage-2-2026-W44");
  });

  it("orders least-recently-emailed first so the batch cap starves nobody", async () => {
    live();
    sheet(); setupDb({ optedIn, lastSent: { "1": 300, "2": 100, "4": 0 } });
    const fetchMock = ok(); vi.stubGlobal("fetch", fetchMock);
    await runReengage({ now: NOW, limit: 2 });
    expect(sentTo(fetchMock)).toEqual(["d@x.io", "b@x.io"]); // never-sent (4), then oldest (2)
  });

  it("refuses before claiming when RESEND_API_KEY or the postal address is missing", async () => {
    live(); delete process.env.RESEND_API_KEY;
    sheet(); setupDb({ optedIn });
    expect((await runReengage({ now: NOW })).blocked).toBe("no_api_key");
    process.env.RESEND_API_KEY = "k"; delete process.env.REENGAGE_POSTAL_ADDRESS;
    expect((await runReengage({ now: NOW })).blocked).toBe("no_postal_address");
    expect(db.reengageEmailSend.createMany).not.toHaveBeenCalled();
  });

  it("does not send when the claim was already taken", async () => {
    live();
    sheet(); setupDb({ optedIn });
    db.reengageEmailSend.createMany.mockResolvedValue({ count: 0 });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const r = await runReengage({ now: NOW, limit: 2 });
    expect(r.alreadyClaimed).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("releases the claim on 5xx so a later run retries, and keeps it on a permanent failure", async () => {
    live();
    sheet(); setupDb({ optedIn: [optedIn[0]] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 503 })));
    let r = await runReengage({ now: NOW });
    expect(r).toMatchObject({ sent: 0, released: 1, failed: 0 });
    expect(db.reengageEmailSend.deleteMany).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 422 })));
    r = await runReengage({ now: NOW });
    expect(r).toMatchObject({ released: 0, failed: 1 });
    expect(db.reengageEmailSend.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "FAILED" } }));
  });

  it("stops the batch on 429 and releases that claim", async () => {
    live();
    sheet(); setupDb({ optedIn });
    const fetchMock = vi.fn(async () => new Response("slow", { status: 429 })); vi.stubGlobal("fetch", fetchMock);
    const r = await runReengage({ now: NOW, limit: 10 });
    expect(r.released).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("releases the claim when the request times out", async () => {
    live();
    sheet(); setupDb({ optedIn: [optedIn[0]] });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("timed out", "TimeoutError"); }));
    expect((await runReengage({ now: NOW })).released).toBe(1);
  });

  it("does not send mail it cannot sign an unsubscribe link for", async () => {
    live();
    delete process.env.SESSION_SECRET;
    sheet(); setupDb({ optedIn: [optedIn[0]] });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const r = await runReengage({ now: NOW });
    expect(r.failed).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explicit dryRun wins even when enabled", async () => {
    live();
    sheet(); setupDb({ optedIn });
    const r = await runReengage({ now: NOW, dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(db.reengageEmailSend.createMany).not.toHaveBeenCalled();
  });
});

describe("sendEmail", () => {
  it("fails without an API key and never calls fetch", async () => {
    const f = vi.fn();
    expect(await sendEmail({ to: "a@b.c", subject: "s", html: "h", text: "t" }, {} as NodeJS.ProcessEnv, f as never)).toMatchObject({ ok: false, reason: "no_api_key" });
    expect(f).not.toHaveBeenCalled();
  });
  it("passes an abort signal and strips CR/LF from the subject", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendEmail({ to: "a@b.c", subject: "Hi\r\nBcc: evil@x.io", html: "h", text: "t" }, { RESEND_API_KEY: "k" } as never, f as never);
    const init = (f.mock.calls[0] as unknown as [string, { signal: AbortSignal; body: string }])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body).subject).toBe("Hi Bcc: evil@x.io");
    expect(oneLine("a\nb")).toBe("a b");
  });
  it("spaces requests to stay under 2 req/s", async () => {
    __setMinInterval(50);
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) await sendEmail({ to: "a@b.c", subject: "s", html: "h", text: "t" }, { RESEND_API_KEY: "k" } as never, f as never);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90);
    __setMinInterval(0);
  });
});
