// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
  memberProfileExtras: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), update: vi.fn(async () => ({})) },
  emailConfirmSend: { create: vi.fn(async () => ({ id: "log1" })), count: vi.fn(), delete: vi.fn(async () => ({})) },
}));
vi.mock("@/app/lib/db", () => ({ prisma: db }));
vi.mock("@/app/lib/auth-guards", () => ({
  requireSession: vi.fn(async () => ({ ok: true, session: { discordId: "d1" } })),
}));
vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberIdByDiscordId: vi.fn(async () => "42") }));

import { GET, POST } from "./route";
import { __setMinInterval } from "@/app/lib/reengage/mailer";

const ex = db.memberProfileExtras;
const post = (body: unknown, type: string | null = "application/json") =>
  new NextRequest("https://app.pizzadao.org/api/email-prefs", {
    method: "POST",
    headers: type ? { "content-type": type, "x-forwarded-for": "1.2.3.4" } : { "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify(body),
  });
const row = (o: Record<string, unknown> = {}) => ({
  email: null, emailVerifiedAt: null, emailConfirmSentAt: null, reengageEmailOptIn: false, locale: "en", ...o,
});
const okFetch = () => vi.fn(async () => new Response("{}", { status: 200 }));

let env: Record<string, string | undefined>;
beforeEach(() => {
  vi.clearAllMocks();
  __setMinInterval(0);
  env = { s: process.env.SESSION_SECRET, k: process.env.RESEND_API_KEY };
  process.env.SESSION_SECRET = "s";
  process.env.RESEND_API_KEY = "k";
  ex.findUnique.mockResolvedValue(row());
  ex.updateMany.mockResolvedValue({ count: 1 });
  db.emailConfirmSend.count.mockResolvedValue(1);
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (env.s === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = env.s;
  if (env.k === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = env.k;
});

describe("/api/email-prefs", () => {
  it("GET reports the real stored state", async () => {
    ex.findUnique.mockResolvedValue(row({ email: "a@x.io", emailVerifiedAt: new Date(), reengageEmailOptIn: true }));
    expect(await (await GET()).json()).toEqual({ email: "a@x.io", verified: true, optIn: true });
    ex.findUnique.mockResolvedValue(null);
    expect(await (await GET()).json()).toEqual({ email: null, verified: false, optIn: false });
  });

  it("requires application/json", async () => {
    expect((await POST(post({ optIn: true }, "text/plain"))).status).toBe(415);
    expect((await POST(post({ optIn: true }, "application/x-www-form-urlencoded"))).status).toBe(415);
    expect((await POST(post({ optIn: true }, null))).status).toBe(415);
    expect(ex.upsert).not.toHaveBeenCalled();
  });

  it("rejects an invalid address", async () => {
    expect((await POST(post({ email: "nope", optIn: true }))).status).toBe(400);
    expect(ex.upsert).not.toHaveBeenCalled();
  });

  it("an empty or null email removes the address and opts out", async () => {
    ex.findUnique.mockResolvedValue(row({ email: "a@x.io", emailVerifiedAt: new Date(), reengageEmailOptIn: true }));
    ex.upsert.mockResolvedValue(row());
    for (const email of ["", "  ", null]) {
      ex.upsert.mockClear();
      const j = await (await POST(post({ email, optIn: true }))).json();
      expect(ex.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { email: null, emailVerifiedAt: null, reengageEmailOptIn: false } }));
      expect(j).toMatchObject({ email: null, verified: false, optIn: false, confirmation: null });
    }
  });

  it("opting in with a new address stores it unverified and sends the confirmation", async () => {
    const f = okFetch(); vi.stubGlobal("fetch", f);
    ex.upsert.mockResolvedValue(row({ email: "a@x.io", reengageEmailOptIn: true }));
    const j = await (await POST(post({ email: "a@x.io", optIn: true }))).json();
    expect(ex.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { email: "a@x.io", emailVerifiedAt: null, reengageEmailOptIn: true } }));
    expect(j).toMatchObject({ verified: false, optIn: true, confirmation: "sent" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body).text).toContain("/email/confirm?m=42&t=");
    // address and IP are logged hashed, never raw
    const logged = JSON.stringify(db.emailConfirmSend.create.mock.calls[0]);
    expect(logged).not.toContain("a@x.io");
    expect(logged).not.toContain("1.2.3.4");
  });

  it("sends no mail when the member has not opted in", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    ex.upsert.mockResolvedValue(row({ email: "a@x.io", reengageEmailOptIn: false }));
    const j = await (await POST(post({ email: "a@x.io", optIn: false }))).json();
    expect(j.confirmation).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("address alternation cannot bypass the 5-minute throttle", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    ex.updateMany.mockResolvedValue({ count: 0 }); // slot taken <5 min ago
    ex.upsert.mockResolvedValue(row({ email: "victim2@x.io", reengageEmailOptIn: true, emailConfirmSentAt: new Date() }));
    const j = await (await POST(post({ email: "victim2@x.io", optIn: true }))).json(); // a brand-new address
    expect(j.confirmation).toBe("too_soon");
    expect(f).not.toHaveBeenCalled();
    // the throttle is claimed with a conditional write, not read-then-write
    expect(ex.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ memberId: "42", OR: expect.any(Array) }),
    }));
  });

  it("parallel POSTs send exactly one confirmation", async () => {
    const f = okFetch(); vi.stubGlobal("fetch", f);
    let taken = false;
    ex.updateMany.mockImplementation(async () => {
      if (taken) return { count: 0 };
      taken = true; // the real write is atomic; model it as first-wins
      return { count: 1 };
    });
    ex.upsert.mockImplementation(async (a: { update: { email?: string } }) =>
      row({ email: a.update.email ?? "a@x.io", reengageEmailOptIn: true }),
    );
    const res = await Promise.all(
      ["a@x.io", "b@x.io", "c@x.io", "d@x.io", "e@x.io"].map((email) => POST(post({ email, optIn: true })).then((r) => r.json())),
    );
    expect(res.filter((r) => r.confirmation === "sent")).toHaveLength(1);
    expect(res.filter((r) => r.confirmation === "too_soon")).toHaveLength(4);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["per member (5/24h)", { memberId: 6 }],
    ["per target address (3/24h)", { emailHash: 4 }],
    ["per IP (10/24h)", { ipHash: 11 }],
  ])("refuses past the daily cap %s and removes its log row", async (_n, over) => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    ex.upsert.mockResolvedValue(row({ email: "a@x.io", reengageEmailOptIn: true }));
    db.emailConfirmSend.count.mockImplementation(async (a: { where: Record<string, unknown> }) => {
      for (const [k, v] of Object.entries(over)) if (k in a.where) return v;
      return 1;
    });
    const j = await (await POST(post({ email: "a@x.io", optIn: true }))).json();
    expect(j.confirmation).toBe("too_many");
    expect(db.emailConfirmSend.delete).toHaveBeenCalledTimes(1);
    expect(f).not.toHaveBeenCalled();
  });
});
