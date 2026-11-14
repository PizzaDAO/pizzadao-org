// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeSettings } from "@/app/lib/newsletter/fake-db";

const h = vi.hoisted(() => ({
  settings: null as unknown,
  setMemberNewsletter: vi.fn(async () => undefined),
  memberNewsletterState: vi.fn(async () => ({ subscribed: true, pending: false })),
  upsert: vi.fn(),
  findUnique: vi.fn(),
}));
vi.mock("@/app/lib/db", () => ({ prisma: { memberProfileExtras: { findUnique: h.findUnique, upsert: h.upsert, updateMany: vi.fn() } } }));
vi.mock("@/app/lib/auth-guards", () => ({ requireSession: vi.fn(async () => ({ ok: true, session: { discordId: "d1" } })) }));
vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberIdByDiscordId: vi.fn(async () => "42") }));
vi.mock("@/app/lib/settings", () => ({ loadSettings: async () => h.settings }));
vi.mock("@/app/lib/newsletter/member", () => ({
  setMemberNewsletter: (...a: unknown[]) => (h.setMemberNewsletter as (...x: unknown[]) => unknown)(...a),
  memberNewsletterState: (...a: unknown[]) => (h.memberNewsletterState as (...x: unknown[]) => unknown)(...a),
}));

import { GET, POST } from "./route";

const verified = { email: "a@example.org", emailVerifiedAt: new Date(), emailConfirmSentAt: null, reengageEmailOptIn: false, locale: "en" };
const post = (body: unknown) =>
  new NextRequest("https://x/api/email-prefs", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("NEWSLETTER_MEMBER_OPT_IN_ENABLED", "");
  h.setMemberNewsletter.mockClear();
  h.memberNewsletterState.mockClear();
  h.findUnique.mockResolvedValue(verified);
  h.upsert.mockResolvedValue(verified);
  h.settings = fakeSettings({ "newsletter.memberOptInEnabled": true });
});

describe("email prefs: Monthly newsletter checkbox", () => {
  it("toggle off: GET has no newsletter field and POST ignores the flag", async () => {
    h.settings = fakeSettings();
    expect(await (await GET()).json()).toEqual({ email: "a@example.org", verified: true, optIn: false });
    const j = await (await POST(post({ email: "a@example.org", newsletter: true }))).json();
    expect(j.newsletter).toBeUndefined();
    expect(h.setMemberNewsletter).not.toHaveBeenCalled();
  });

  it("toggle on: GET reports the state, POST applies it with the verified flag", async () => {
    const got = (await (await GET()).json()).newsletter;
    expect(got).toMatchObject({ subscribed: true, pending: false });
    expect(h.memberNewsletterState).toHaveBeenCalledWith("a@example.org", true);
    const res = await POST(post({ email: "a@example.org", optIn: false, newsletter: true }));
    expect(res.status).toBe(200);
    expect(h.setMemberNewsletter).toHaveBeenCalledWith("42", "a@example.org", true, true);
  });

  it("is independent of the digest opt-in and validates the flag", async () => {
    await POST(post({ newsletter: false }));
    expect(h.setMemberNewsletter).toHaveBeenCalledWith("42", "a@example.org", true, false);
    expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }));
    expect((await POST(post({ newsletter: "yes" }))).status).toBe(400);
  });

  it("H1: the lookup is told when the saved address is unverified", async () => {
    h.findUnique.mockResolvedValue({ ...verified, emailVerifiedAt: null });
    await GET();
    expect(h.memberNewsletterState).toHaveBeenCalledWith("a@example.org", false);
  });

  it("L4: canSendConfirm is true only with the confirmation switch on and a sender set", async () => {
    expect((await (await GET()).json()).newsletter.canSendConfirm).toBe(false);
    h.settings = fakeSettings({ "newsletter.memberOptInEnabled": true, "newsletter.confirmEmailsEnabled": true });
    expect((await (await GET()).json()).newsletter.canSendConfirm).toBe(false);
    h.settings = fakeSettings({ "newsletter.memberOptInEnabled": true, "newsletter.confirmEmailsEnabled": true, "newsletter.fromAddress": "news@example.org" });
    expect((await (await GET()).json()).newsletter.canSendConfirm).toBe(true);
  });

  it("L3: an unrelated prefs save never touches the newsletter", async () => {
    await POST(post({ email: "a@example.org", optIn: true }));
    await POST(post({ resend: true }));
    expect(h.setMemberNewsletter).not.toHaveBeenCalled();
  });

  it("the env kill switch hides it", async () => {
    vi.stubEnv("NEWSLETTER_MEMBER_OPT_IN_ENABLED", "0");
    expect((await (await GET()).json()).newsletter).toBeUndefined();
  });
});
