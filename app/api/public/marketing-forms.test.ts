// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSettings = vi.fn();
const create = vi.fn();
const contactCreate = vi.fn();
const contactUpdate = vi.fn();
const sendEmail = vi.fn();
const upcomingEvents = vi.fn();
const enforceRateLimit = vi.fn();

vi.mock("@/app/lib/settings", () => ({ loadSettings: () => loadSettings() }));
vi.mock("@/app/lib/db", () => ({
  prisma: {
    newsletterSubscriber: { create: (...a: unknown[]) => create(...a) },
    contactSubmission: { create: (...a: unknown[]) => contactCreate(...a), update: (...a: unknown[]) => contactUpdate(...a) },
  },
}));
vi.mock("@/app/lib/rate-limit", () => ({ enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a) }));
vi.mock("@/app/lib/reengage/mailer", () => ({
  oneLine: (s: string) => s,
  sendEmail: (...a: unknown[]) => sendEmail(...a),
}));
vi.mock("@/app/lib/marketing/calendar", () => ({ upcomingEvents: (...a: unknown[]) => upcomingEvents(...a) }));

import { POST as newsletter } from "./newsletter/route";
import { POST as contact } from "./contact/route";
import { GET as calendar } from "./calendar/route";

const settings = (over: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = {
    "marketing.newsletterEnabled": true,
    "marketing.contactEnabled": true,
    "marketing.calendarEnabled": true,
    "marketing.contactNotifyEmail": "",
    "marketing.calendarIcsUrl": "https://example.org/cal.ics",
    ...over,
  };
  return { readFailed: false, invalidKeys: [], isSet: () => true, get: (k: string) => values[k] };
};
const post = (body: unknown) => new Request("https://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(() => {
  for (const m of [loadSettings, create, contactCreate, contactUpdate, sendEmail, upcomingEvents, enforceRateLimit]) m.mockReset();
  enforceRateLimit.mockResolvedValue(null);
  loadSettings.mockResolvedValue(settings());
  vi.stubEnv("VERCEL_ENV", "production");
  for (const k of ["MARKETING_NEWSLETTER_ENABLED", "MARKETING_CONTACT_ENABLED", "MARKETING_CALENDAR_ENABLED"]) vi.stubEnv(k, "");
});

describe("POST /api/public/newsletter", () => {
  it("503s while the switch is off and stores nothing", async () => {
    loadSettings.mockResolvedValue(settings({ "marketing.newsletterEnabled": false }));
    expect((await newsletter(post({ email: "a@b.co" }))).status).toBe(503);
    expect(create).not.toHaveBeenCalled();
  });

  it("the env kill switch wins over a saved ON", async () => {
    vi.stubEnv("MARKETING_NEWSLETTER_ENABLED", "0");
    expect((await newsletter(post({ email: "a@b.co" }))).status).toBe(503);
  });

  it("stores a lower-cased address", async () => {
    create.mockResolvedValue({});
    const res = await newsletter(post({ email: "A@B.co", source: "footer" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(create).toHaveBeenCalledWith({ data: { email: "a@b.co", source: "footer" } });
  });

  it("answers already: true for a repeat address", async () => {
    create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    expect(await (await newsletter(post({ email: "a@b.co" }))).json()).toEqual({ ok: true, already: true });
  });

  it("400s on a bad address, 500s on a database error, passes a rate limit through", async () => {
    expect((await newsletter(post({ email: "nope" }))).status).toBe(400);
    create.mockRejectedValue(new Error("db down"));
    expect((await newsletter(post({ email: "a@b.co" }))).status).toBe(500);
    enforceRateLimit.mockResolvedValue(new Response("slow down", { status: 429 }));
    expect((await newsletter(post({ email: "a@b.co" }))).status).toBe(429);
  });
});

describe("POST /api/public/contact", () => {
  const body = { name: "Ada", email: "ada@example.org", message: "hello", intents: ["Partnership"] };

  it("503s while the switch is off", async () => {
    loadSettings.mockResolvedValue(settings({ "marketing.contactEnabled": false }));
    expect((await contact(post(body))).status).toBe(503);
    expect(contactCreate).not.toHaveBeenCalled();
  });

  it("stores the message and sends no email when no address is set", async () => {
    contactCreate.mockResolvedValue({ id: "c1" });
    const res = await contact(post(body));
    expect(await res.json()).toEqual({ ok: true, emailed: false });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("emails the team and records it when an address is set", async () => {
    loadSettings.mockResolvedValue(settings({ "marketing.contactNotifyEmail": "team@example.org" }));
    contactCreate.mockResolvedValue({ id: "c1" });
    sendEmail.mockResolvedValue({ ok: true, id: "m1" });
    expect(await (await contact(post(body))).json()).toEqual({ ok: true, emailed: true });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "team@example.org", idempotencyKey: "contact-c1", headers: { "Reply-To": "ada@example.org" } }));
    expect(contactUpdate).toHaveBeenCalledWith({ where: { id: "c1" }, data: { emailed: true } });
  });

  it("a failed email still answers ok (the message is stored)", async () => {
    loadSettings.mockResolvedValue(settings({ "marketing.contactNotifyEmail": "team@example.org" }));
    contactCreate.mockResolvedValue({ id: "c1" });
    sendEmail.mockResolvedValue({ ok: false, reason: "no_api_key", retryable: false });
    expect(await (await contact(post(body))).json()).toEqual({ ok: true, emailed: false });
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("400s on invalid input and 500s when the database fails", async () => {
    expect((await contact(post({ ...body, email: "x" }))).status).toBe(400);
    contactCreate.mockRejectedValue(new Error("db"));
    expect((await contact(post(body))).status).toBe(500);
  });
});

describe("GET /api/public/calendar", () => {
  const req = () => new Request("https://x/api/public/calendar");

  it("returns an empty list while off or with no feed, without fetching", async () => {
    loadSettings.mockResolvedValue(settings({ "marketing.calendarEnabled": false }));
    expect(await (await calendar(req())).json()).toEqual({ events: [] });
    loadSettings.mockResolvedValue(settings({ "marketing.calendarIcsUrl": "" }));
    expect(await (await calendar(req())).json()).toEqual({ events: [] });
    expect(upcomingEvents).not.toHaveBeenCalled();
  });

  it("returns the events with a public cache header", async () => {
    upcomingEvents.mockResolvedValue([{ title: "Call" }]);
    const res = await calendar(req());
    expect((await res.json()).events).toEqual([{ title: "Call" }]);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=300");
  });

  it("an unreadable feed is an empty list, not an error status", async () => {
    upcomingEvents.mockRejectedValue(new Error("boom"));
    const res = await calendar(req());
    expect(res.status).toBe(200);
    expect((await res.json()).events).toEqual([]);
  });
});
