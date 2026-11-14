// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSettings } from "./fake-db";
import { emptySections } from "./sections";

const h = vi.hoisted(() => ({
  events: [] as Array<{ id: string; actor: string; action: string; createdAt: Date; data?: unknown }>,
  sent: [] as Array<{ to: string }>,
}));

vi.mock("@/app/lib/db", () => ({
  prisma: {
    newsletterIssue: { findUnique: async () => ({ id: "i1", subject: "S", preheader: "", sections: (() => { const s = emptySections(); s.intro = "Hi"; return s; })() }) },
    memberProfileExtras: { findUnique: async () => ({ email: "me@example.org", emailVerifiedAt: new Date() }) },
    newsletterIssueEvent: {
      create: async ({ data }: { data: { actor: string; action: string; data?: unknown } }) => {
        const row = { id: `e${h.events.length + 1}`, actor: data.actor, action: data.action, createdAt: new Date(), data: data.data };
        h.events.push(row);
        return { id: row.id };
      },
      count: async ({ where }: { where: { actor: string; action: string } }) => h.events.filter((e) => e.actor === where.actor && e.action === where.action).length,
      delete: async ({ where }: { where: { id: string } }) => void (h.events = h.events.filter((e) => e.id !== where.id)),
      update: async () => ({}),
    },
  },
}));
vi.mock("@/app/lib/auth-guards", () => ({ hasAnyRoleSafe: async () => false, isAdminDiscordId: async () => false, requireSession: async () => ({ ok: false }) }));
vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberIdByDiscordId: async () => "m1" }));
vi.mock("@/app/lib/reengage/mailer", () => ({
  postalAddress: () => null,
  sendEmail: async (m: { to: string }) => {
    h.sent.push({ to: m.to });
    return { ok: true, id: "r1" };
  },
}));
vi.mock("@/app/lib/settings", () => ({
  loadSettings: async () => fakeSettings({ "newsletter.fromAddress": "news@example.org", "newsletter.confirmEmailsEnabled": true }),
}));

import { sendTestIssue, TEST_SENDS_PER_HOUR } from "./test-send";

beforeEach(() => {
  h.events = [];
  h.sent = [];
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("RESEND_API_KEY", "key");
  vi.stubEnv("NEWSLETTER_CONFIRM_EMAILS_ENABLED", "");
});

describe("test send limit", () => {
  it("goes only to the admin's own verified address", async () => {
    expect(await sendTestIssue("i1", "adminA")).toEqual({ ok: true });
    expect(h.sent).toEqual([{ to: "me@example.org" }]);
  });

  it("caps sends per admin per hour (claimed before sending) and does not count another admin's", async () => {
    for (let n = 0; n < TEST_SENDS_PER_HOUR; n++) expect((await sendTestIssue("i1", "adminA")).ok).toBe(true);
    const over = await sendTestIssue("i1", "adminA");
    expect(over).toMatchObject({ ok: false, status: 429 });
    expect(h.sent).toHaveLength(TEST_SENDS_PER_HOUR);
    expect(h.events.filter((e) => e.actor === "adminA")).toHaveLength(TEST_SENDS_PER_HOUR); // the refused claim is released
    expect((await sendTestIssue("i1", "adminB")).ok).toBe(true);
  });

  it("parallel requests can't both pass under the cap", async () => {
    const results = await Promise.all(Array.from({ length: TEST_SENDS_PER_HOUR + 5 }, () => sendTestIssue("i1", "adminA")));
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(TEST_SENDS_PER_HOUR);
    expect(h.sent.length).toBeLessThanOrEqual(TEST_SENDS_PER_HOUR);
  });
});
