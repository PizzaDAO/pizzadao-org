// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSettings, makeFakeDb } from "./fake-db";

const h = vi.hoisted(() => ({ db: null as unknown, settings: null as unknown, sendEmail: vi.fn() }));
vi.mock("@/app/lib/db", () => ({ get prisma() { return (h.db as { prisma: unknown }).prisma; } }));
vi.mock("@/app/lib/settings", () => ({ loadSettings: async () => h.settings }));
vi.mock("@/app/lib/reengage/mailer", () => ({
  oneLine: (s: string) => s,
  postalAddress: () => "1 Example Street",
  sendEmail: (...a: unknown[]) => h.sendEmail(...a),
}));

import { confirmSubscriber, requestSubscription, unsubscribeSubscriber } from "./subscribe";
import { setMemberNewsletter, memberNewsletterState } from "./member";
import { isMailable } from "./consent";

const NOW = 1_800_000_000_000;
let fake: ReturnType<typeof makeFakeDb>;
const ON = { "newsletter.confirmEmailsEnabled": true, "newsletter.fromAddress": "news@example.org", "newsletter.fromName": "Example News" };
const use = (settings: Record<string, unknown>, seed: Parameters<typeof makeFakeDb>[0] = []) => {
  fake = makeFakeDb(seed);
  h.db = fake;
  h.settings = fakeSettings(settings);
};

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("NEWSLETTER_CONFIRM_EMAILS_ENABLED", "");
  vi.stubEnv("UNSUBSCRIBE_SECRET", "test-secret");
  h.sendEmail.mockReset();
  h.sendEmail.mockResolvedValue({ ok: true, id: "r1" });
  use({});
});

describe("double opt-in signup", () => {
  it("a new address is stored pending, never subscribed", async () => {
    expect(await requestSubscription({ email: "a@example.org", source: "footer" }, NOW)).toBe("created");
    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0]).toMatchObject({ email: "a@example.org", status: "pending", confirmedAt: null, source: "footer" });
  });

  it("sends the confirmation from the configured sender with one-click unsubscribe headers", async () => {
    use(ON);
    await requestSubscription({ email: "a@example.org", source: "footer" }, NOW);
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    const msg = h.sendEmail.mock.calls[0][0];
    expect(msg.to).toBe("a@example.org");
    expect(msg.from).toBe("Example News <news@example.org>");
    expect(msg.html).toContain("/newsletter/confirm?s=");
    expect(msg.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(msg.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/.+\/api\/public\/newsletter\/unsubscribe\?s=/);
    expect(fake.rows[0].confirmSends).toBe(1);
  });

  it("sends nothing while the toggle is off or no sender address is configured", async () => {
    use({ "newsletter.fromAddress": "news@example.org" });
    await requestSubscription({ email: "a@example.org", source: "footer" }, NOW);
    use({ "newsletter.confirmEmailsEnabled": true });
    await requestSubscription({ email: "b@example.org", source: "footer" }, NOW);
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(fake.rows[0].status).toBe("pending");
  });

  it("the env kill switch stops confirmation emails", async () => {
    use(ON);
    vi.stubEnv("NEWSLETTER_CONFIRM_EMAILS_ENABLED", "0");
    await requestSubscription({ email: "a@example.org", source: "footer" }, NOW);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("previews ignore the saved toggle", async () => {
    use(ON);
    vi.stubEnv("VERCEL_ENV", "preview");
    await requestSubscription({ email: "a@example.org", source: "footer" }, NOW);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("a pending address is re-sent at most once an hour and three a day", async () => {
    use(ON);
    await requestSubscription({ email: "a@example.org", source: "footer" }, NOW);
    await requestSubscription({ email: "a@example.org", source: "footer" }, NOW + 10 * 60_000);
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    await requestSubscription({ email: "a@example.org", source: "footer" }, NOW + 61 * 60_000);
    await requestSubscription({ email: "a@example.org", source: "footer" }, NOW + 122 * 60_000);
    await requestSubscription({ email: "a@example.org", source: "footer" }, NOW + 183 * 60_000);
    expect(h.sendEmail).toHaveBeenCalledTimes(3);
    await requestSubscription({ email: "a@example.org", source: "footer" }, NOW + 183 * 60_000 + 25 * 3600_000);
    expect(h.sendEmail).toHaveBeenCalledTimes(4);
  });

  it("an already confirmed address gets no email and is left untouched", async () => {
    use(ON, [{ email: "a@example.org", status: "subscribed", confirmedAt: new Date(NOW - 1000) }]);
    expect(await requestSubscription({ email: "a@example.org", source: "footer" }, NOW)).toBe("none");
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(fake.rows[0]).toMatchObject({ status: "subscribed", confirmSends: 0 });
  });

  it("an unsubscribed address goes back to pending and needs a new confirmation", async () => {
    use(ON, [{ email: "a@example.org", status: "unsubscribed", confirmedAt: new Date(NOW - 5000), unsubscribedAt: new Date(NOW - 1000) }]);
    expect(await requestSubscription({ email: "a@example.org", source: "footer" }, NOW)).toBe("reconfirm");
    expect(fake.rows[0]).toMatchObject({ status: "pending", confirmedAt: null });
    expect(isMailable(fake.rows[0])).toBe(false);
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("a legacy unconfirmed row becomes pending and stays unmailable", async () => {
    use(ON, [{ email: "old@example.org", status: "subscribed" }]);
    await requestSubscription({ email: "old@example.org", source: "footer" }, NOW);
    expect(fake.rows[0]).toMatchObject({ status: "pending", confirmedAt: null });
  });
});

describe("confirm", () => {
  it("confirms once, then reports already; the row becomes mailable", async () => {
    use({}, [{ email: "a@example.org", status: "pending" }]);
    expect(await confirmSubscriber("sub1", NOW - 1000, new Date(NOW))).toBe("confirmed");
    expect(fake.rows[0]).toMatchObject({ status: "subscribed", confirmedAt: new Date(NOW) });
    expect(await confirmSubscriber("sub1", NOW - 1000, new Date(NOW + 5))).toBe("already");
    expect(fake.rows[0].confirmedAt).toEqual(new Date(NOW));
  });

  it("an old link cannot re-subscribe someone who unsubscribed after it was issued", async () => {
    use({}, [{ email: "a@example.org", status: "unsubscribed", unsubscribedAt: new Date(NOW) }]);
    expect(await confirmSubscriber("sub1", NOW - 1000, new Date(NOW + 10))).toBe("invalid");
    expect(fake.rows[0].status).toBe("unsubscribed");
    expect(await confirmSubscriber("nope", NOW)).toBe("invalid");
  });
});

describe("unsubscribe", () => {
  it("is idempotent and keeps the first timestamp and reason", async () => {
    use({}, [{ email: "a@example.org", status: "subscribed", confirmedAt: new Date(NOW - 1000) }]);
    expect(await unsubscribeSubscriber("sub1", "user", new Date(NOW))).toBe("unsubscribed");
    expect(await unsubscribeSubscriber("sub1", "user", new Date(NOW + 999))).toBe("already");
    expect(fake.rows[0]).toMatchObject({ status: "unsubscribed", unsubscribedAt: new Date(NOW), lastStatusReason: "user" });
    expect(await unsubscribeSubscriber("nope")).toBe("missing");
  });

  it("works on a pending row too (and then it can never be confirmed by an older link)", async () => {
    use({}, [{ email: "a@example.org", status: "pending" }]);
    expect(await unsubscribeSubscriber("sub1", "user", new Date(NOW))).toBe("unsubscribed");
    expect(await confirmSubscriber("sub1", NOW - 5, new Date(NOW + 1))).toBe("invalid");
  });
});

describe("member checkbox", () => {
  it("ticking with a verified address is the opt-in: confirmed now, source member, no email", async () => {
    use(ON);
    await setMemberNewsletter("m1", "A@Example.org", true, true, new Date(NOW));
    expect(fake.rows[0]).toMatchObject({ email: "a@example.org", status: "subscribed", confirmedAt: new Date(NOW), source: "member", memberId: "m1" });
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(await memberNewsletterState("a@example.org")).toEqual({ subscribed: true, pending: false });
  });

  it("ticking with an unverified address goes through the double opt-in", async () => {
    use(ON);
    await setMemberNewsletter("m1", "a@example.org", false, true, new Date(NOW));
    expect(fake.rows[0]).toMatchObject({ status: "pending", confirmedAt: null, memberId: "m1" });
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    expect(await memberNewsletterState("a@example.org")).toEqual({ subscribed: false, pending: true });
  });

  it("ticking re-subscribes a verified member who had unsubscribed, unticking unsubscribes", async () => {
    use({}, [{ email: "a@example.org", status: "unsubscribed", unsubscribedAt: new Date(NOW - 10) }]);
    await setMemberNewsletter("m1", "a@example.org", true, true, new Date(NOW));
    expect(fake.rows[0]).toMatchObject({ status: "subscribed", confirmedAt: new Date(NOW), unsubscribedAt: null });
    await setMemberNewsletter("m1", "a@example.org", true, false, new Date(NOW + 1));
    expect(fake.rows[0]).toMatchObject({ status: "unsubscribed", lastStatusReason: "user" });
  });
});
