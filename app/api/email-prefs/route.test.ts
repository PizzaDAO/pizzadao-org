// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const ex = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(async () => ({})) }));
vi.mock("@/app/lib/db", () => ({ prisma: { memberProfileExtras: ex } }));
vi.mock("@/app/lib/auth-guards", () => ({
  requireSession: vi.fn(async () => ({ ok: true, session: { discordId: "d1" } })),
}));
vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberIdByDiscordId: vi.fn(async () => "42") }));

import { GET, POST } from "./route";
import { __setMinInterval } from "@/app/lib/reengage/mailer";

const post = (body: unknown) =>
  new NextRequest("https://app.pizzadao.org/api/email-prefs", { method: "POST", body: JSON.stringify(body) });
const row = (o: Record<string, unknown> = {}) => ({
  email: null, emailVerifiedAt: null, emailConfirmSentAt: null, reengageEmailOptIn: false, locale: "en", ...o,
});

let env: Record<string, string | undefined>;
beforeEach(() => {
  vi.clearAllMocks();
  __setMinInterval(0);
  env = { s: process.env.SESSION_SECRET, k: process.env.RESEND_API_KEY };
  process.env.SESSION_SECRET = "s";
  process.env.RESEND_API_KEY = "k";
  ex.findUnique.mockResolvedValue(row());
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

  it("rejects an invalid address", async () => {
    expect((await POST(post({ email: "nope", optIn: true }))).status).toBe(400);
    expect(ex.upsert).not.toHaveBeenCalled();
  });

  it("opting in with a new address stores it unverified and sends the confirmation", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 })); vi.stubGlobal("fetch", f);
    ex.upsert.mockResolvedValue(row({ email: "a@x.io", reengageEmailOptIn: true }));
    const j = await (await POST(post({ email: "a@x.io", optIn: true }))).json();
    expect(ex.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { email: "a@x.io", emailVerifiedAt: null, reengageEmailOptIn: true } }));
    expect(j).toMatchObject({ verified: false, optIn: true, confirmation: "sent" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body).text).toContain("/email/confirm?m=42&t=");
  });

  it("sends no mail when the member has not opted in", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    ex.upsert.mockResolvedValue(row({ email: "a@x.io", reengageEmailOptIn: false }));
    const j = await (await POST(post({ email: "a@x.io", optIn: false }))).json();
    expect(j.confirmation).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("throttles a resend and does not re-verify an unchanged address", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    ex.findUnique.mockResolvedValue(row({ email: "a@x.io", reengageEmailOptIn: true, emailConfirmSentAt: new Date() }));
    ex.upsert.mockResolvedValue(row({ email: "a@x.io", reengageEmailOptIn: true, emailConfirmSentAt: new Date() }));
    const j = await (await POST(post({ resend: true }))).json();
    expect(j.confirmation).toBe("too_soon");
    expect(f).not.toHaveBeenCalled();
    ex.upsert.mockClear();
    await POST(post({ email: "A@X.io", optIn: true }));
    expect(ex.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { reengageEmailOptIn: true } }));
  });
});
