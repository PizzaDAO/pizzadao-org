// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSettings, makeFakeDb } from "@/app/lib/newsletter/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown, settings: null as unknown, sendEmail: vi.fn(), limited: null as Response | null }));
vi.mock("@/app/lib/db", () => ({ get prisma() { return (h.db as { prisma: unknown }).prisma; } }));
vi.mock("@/app/lib/settings", () => ({ loadSettings: async () => h.settings }));
vi.mock("@/app/lib/rate-limit", () => ({ enforceRateLimit: async () => h.limited }));
vi.mock("@/app/lib/reengage/mailer", () => ({
  oneLine: (s: string) => s,
  postalAddress: () => null,
  sendEmail: (...a: unknown[]) => h.sendEmail(...a),
}));

import * as signup from "./route";
import * as confirm from "./confirm/route";
import * as unsub from "./unsubscribe/route";
import { signNewsletterConfirm, signNewsletterUnsub } from "@/app/lib/newsletter/sig";
import { NextRequest } from "next/server";

const NOW = Date.now();
const ON = { "newsletter.confirmEmailsEnabled": true, "newsletter.fromAddress": "news@example.org" };
let fake: ReturnType<typeof makeFakeDb>;
const use = (settings: Record<string, unknown>, seed: Parameters<typeof makeFakeDb>[0] = []) => {
  fake = makeFakeDb(seed);
  h.db = fake;
  h.settings = fakeSettings(settings);
};
const jpost = (email: unknown, extra: object = {}) =>
  new Request("https://x/api/public/newsletter", { method: "POST", body: JSON.stringify({ email, ...extra }), headers: { "content-type": "application/json" } });
const nreq = (url: string, init: { body?: string; type?: string } = {}) =>
  new NextRequest(url, { method: "POST", body: init.body, headers: init.type ? { "content-type": init.type } : {} });

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("UNSUBSCRIBE_SECRET", "test-secret");
  vi.stubEnv("MARKETING_NEWSLETTER_ENABLED", "");
  vi.stubEnv("NEWSLETTER_CONFIRM_EMAILS_ENABLED", "");
  h.limited = null;
  h.sendEmail.mockReset();
  h.sendEmail.mockResolvedValue({ ok: true, id: "r1" });
  use(ON);
});

describe("POST /api/public/newsletter answers the same in every case", () => {
  it("new, pending, confirmed, unsubscribed and legacy addresses all get the identical response", async () => {
    use(ON, [
      { email: "pending@example.org", status: "pending" },
      { email: "confirmed@example.org", status: "subscribed", confirmedAt: new Date(NOW - 5000) },
      { email: "gone@example.org", status: "unsubscribed", confirmedAt: new Date(NOW - 5000), unsubscribedAt: new Date(NOW - 1000) },
      { email: "legacy@example.org", status: "subscribed" },
    ]);
    const seen: Array<{ status: number; body: unknown }> = [];
    for (const email of ["new@example.org", "pending@example.org", "confirmed@example.org", "gone@example.org", "legacy@example.org", "NEW@example.org"]) {
      const res = await signup.POST(jpost(email));
      seen.push({ status: res.status, body: await res.json() });
    }
    for (const s of seen) expect(s).toEqual({ status: 200, body: { ok: true } });
    // ...while the effects differ: only the confirmed row stays untouched, and nobody is subscribed by a signup.
    expect(fake.rows.find((r) => r.email === "confirmed@example.org")).toMatchObject({ status: "subscribed", confirmSends: 0 });
    expect(fake.rows.filter((r) => r.status === "subscribed" && r.confirmedAt === null)).toHaveLength(0);
  });

  it("with the confirmation switch off, signups are stored pending and nothing is sent", async () => {
    use({});
    const res = await signup.POST(jpost("a@example.org"));
    expect(await res.json()).toEqual({ ok: true });
    expect(fake.rows[0].status).toBe("pending");
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("503 while the website switch is off, 400 on a bad address, 429 from the rate limit", async () => {
    use({ "marketing.newsletterEnabled": false });
    expect((await signup.POST(jpost("a@example.org"))).status).toBe(503);
    use(ON);
    expect((await signup.POST(jpost("nope"))).status).toBe(400);
    h.limited = new Response("slow", { status: 429 });
    expect((await signup.POST(jpost("a@example.org"))).status).toBe(429);
    expect(fake.rows).toHaveLength(0);
  });
});

describe("confirm and unsubscribe are POST-only", () => {
  it("export no GET handler (link scanners prefetch GETs)", () => {
    expect("GET" in confirm).toBe(false);
    expect("GET" in unsub).toBe(false);
    expect("GET" in signup).toBe(false);
  });
});

describe("POST /api/public/newsletter/confirm", () => {
  const link = (id: string, email: string, now = NOW) => `https://x/api/public/newsletter/confirm?s=${id}&t=${signNewsletterConfirm(id, email, now)}`;

  it("confirms with a valid token, idempotently", async () => {
    use({}, [{ email: "a@example.org", status: "pending" }]);
    const res = await confirm.POST(nreq(link("sub1", "a@example.org")));
    expect(res.status).toBe(200);
    expect(fake.rows[0]).toMatchObject({ status: "subscribed" });
    expect(fake.rows[0].confirmedAt).not.toBeNull();
    const first = fake.rows[0].confirmedAt;
    expect((await confirm.POST(nreq(link("sub1", "a@example.org")))).status).toBe(200);
    expect(fake.rows[0].confirmedAt).toEqual(first);
  });

  it("rejects a bad token, another address's token and an expired token", async () => {
    use({}, [{ email: "a@example.org", status: "pending" }]);
    expect((await confirm.POST(nreq("https://x/api/public/newsletter/confirm?s=sub1&t=1.bad"))).status).toBe(400);
    expect((await confirm.POST(nreq(link("sub1", "other@example.org")))).status).toBe(400);
    expect((await confirm.POST(nreq(link("sub1", "a@example.org", NOW - 8 * 24 * 3600_000)))).status).toBe(400);
    expect((await confirm.POST(nreq("https://x/api/public/newsletter/confirm"))).status).toBe(400);
    expect(fake.rows[0].status).toBe("pending");
  });

  it("a form post from the page is redirected back with done=1", async () => {
    use({}, [{ email: "a@example.org", status: "pending" }]);
    const res = await confirm.POST(nreq(link("sub1", "a@example.org"), { type: "application/x-www-form-urlencoded", body: "" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/newsletter/confirm");
    expect(res.headers.get("location")).toContain("done=1");
  });

  it("passes a rate limit through", async () => {
    use({}, [{ email: "a@example.org", status: "pending" }]);
    h.limited = new Response("slow", { status: 429 });
    expect((await confirm.POST(nreq(link("sub1", "a@example.org")))).status).toBe(429);
    expect(fake.rows[0].status).toBe("pending");
  });
});

describe("POST /api/public/newsletter/unsubscribe", () => {
  const link = (id: string) => `https://x/api/public/newsletter/unsubscribe?s=${id}&sig=${signNewsletterUnsub(id)}`;

  it("one-click (RFC 8058) unsubscribes and answers a plain 200", async () => {
    use({}, [{ email: "a@example.org", status: "subscribed", confirmedAt: new Date(NOW - 5000) }]);
    const res = await unsub.POST(nreq(link("sub1"), { type: "application/x-www-form-urlencoded", body: "List-Unsubscribe=One-Click" }));
    expect(res.status).toBe(200);
    expect(fake.rows[0]).toMatchObject({ status: "unsubscribed", lastStatusReason: "user" });
    expect(fake.rows[0].unsubscribedAt).not.toBeNull();
  });

  it("is idempotent: a second POST is a 200 and keeps the first timestamp", async () => {
    use({}, [{ email: "a@example.org", status: "subscribed", confirmedAt: new Date(NOW - 5000) }]);
    await unsub.POST(nreq(link("sub1"), { body: "List-Unsubscribe=One-Click" }));
    const first = fake.rows[0].unsubscribedAt;
    expect((await unsub.POST(nreq(link("sub1"), { body: "List-Unsubscribe=One-Click" }))).status).toBe(200);
    expect(fake.rows[0].unsubscribedAt).toEqual(first);
  });

  it("has no per-IP rate limit (RFC 8058 posts come from shared provider addresses)", async () => {
    use({}, [{ email: "a@example.org", status: "subscribed", confirmedAt: new Date(NOW - 5000) }]);
    h.limited = new Response("slow", { status: 429 });
    expect((await unsub.POST(nreq(link("sub1"), { body: "List-Unsubscribe=One-Click" }))).status).toBe(200);
    expect(fake.rows[0].status).toBe("unsubscribed");
  });

  it("rejects a forged or missing signature and changes nothing", async () => {
    use({}, [{ email: "a@example.org", status: "subscribed", confirmedAt: new Date(NOW - 5000) }]);
    expect((await unsub.POST(nreq("https://x/api/public/newsletter/unsubscribe?s=sub1&sig=forged"))).status).toBe(400);
    expect((await unsub.POST(nreq("https://x/api/public/newsletter/unsubscribe?s=sub1"))).status).toBe(400);
    expect(fake.rows[0].status).toBe("subscribed");
  });

  it("a browser form post is redirected to the confirmation page", async () => {
    use({}, [{ email: "a@example.org", status: "subscribed", confirmedAt: new Date(NOW - 5000) }]);
    const res = await unsub.POST(nreq(link("sub1"), { type: "application/x-www-form-urlencoded", body: "" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("done=1");
  });

  it("re-subscribing afterwards needs a new confirmation", async () => {
    use(ON, [{ email: "a@example.org", status: "subscribed", confirmedAt: new Date(NOW - 5000) }]);
    await unsub.POST(nreq(link("sub1"), { body: "List-Unsubscribe=One-Click" }));
    await signup.POST(jpost("a@example.org"));
    expect(fake.rows[0]).toMatchObject({ status: "pending", confirmedAt: null });
  });
});
