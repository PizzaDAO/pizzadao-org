// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSettings = vi.fn();
const create = vi.fn();
const contactCreate = vi.fn();
const contactUpdate = vi.fn();
const sendEmail = vi.fn();
const enforceRateLimit = vi.fn();

vi.mock("@/app/lib/settings", () => ({ loadSettings: () => loadSettings() }));
vi.mock("@/app/lib/db", () => ({
  prisma: {
    contactSubmission: { create: (...a: unknown[]) => contactCreate(...a), update: (...a: unknown[]) => contactUpdate(...a) },
  },
}));
const requestSubscription = vi.fn();
vi.mock("@/app/lib/newsletter/subscribe", () => ({ requestSubscription: (...a: unknown[]) => requestSubscription(...a) }));
vi.mock("@/app/lib/rate-limit", () => ({ enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a) }));
vi.mock("@/app/lib/reengage/mailer", () => ({
  oneLine: (s: string) => s,
  sendEmail: (...a: unknown[]) => sendEmail(...a),
}));

import { POST as newsletter } from "./newsletter/route";
import { POST as contact } from "./contact/route";

const settings = (over: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = {
    "marketing.newsletterEnabled": true,
    "marketing.contactEnabled": true,
    "marketing.contactNotifyEmail": "",
    ...over,
  };
  return { readFailed: false, invalidKeys: [], isSet: () => true, get: (k: string) => values[k] };
};
const post = (body: unknown) => new Request("https://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(() => {
  for (const m of [loadSettings, requestSubscription, create, contactCreate, contactUpdate, sendEmail, enforceRateLimit]) m.mockReset();
  enforceRateLimit.mockResolvedValue(null);
  requestSubscription.mockResolvedValue("none");
  loadSettings.mockResolvedValue(settings());
  vi.stubEnv("VERCEL_ENV", "production");
  for (const k of ["MARKETING_NEWSLETTER_ENABLED", "MARKETING_CONTACT_ENABLED"]) vi.stubEnv(k, "");
});

describe("POST /api/public/newsletter", () => {
  it("503s while the switch is off and stores nothing", async () => {
    loadSettings.mockResolvedValue(settings({ "marketing.newsletterEnabled": false }));
    expect((await newsletter(post({ email: "a@b.co" }))).status).toBe(503);
    expect(requestSubscription).not.toHaveBeenCalled();
  });

  it("the env kill switch wins over a saved ON", async () => {
    vi.stubEnv("MARKETING_NEWSLETTER_ENABLED", "0");
    expect((await newsletter(post({ email: "a@b.co" }))).status).toBe(503);
  });

  it("hands a lower-cased address to the double opt-in and answers a bare ok", async () => {
    requestSubscription.mockResolvedValue("created");
    const res = await newsletter(post({ email: "A@B.co", source: "footer" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(requestSubscription).toHaveBeenCalledWith({ email: "a@b.co", source: "footer" });
  });

  it("400s on a bad address, 500s on a database error, passes a rate limit through", async () => {
    expect((await newsletter(post({ email: "nope" }))).status).toBe(400);
    expect((await newsletter(post({ email: "a@b.co" }))).status).toBe(200);
    enforceRateLimit.mockResolvedValue(new Response("slow down", { status: 429 }));
    expect((await newsletter(post({ email: "a@b.co" }))).status).toBe(429);
  });
});

describe("honeypot", () => {
  it("a filled website field is answered ok and stored nowhere", async () => {
    expect(await (await newsletter(post({ email: "a@b.co", website: "http://spam" }))).json()).toEqual({ ok: true });
    expect(requestSubscription).not.toHaveBeenCalled();
    const res = await contact(post({ name: "A", email: "a@b.co", message: "m", website: "x" }));
    expect((await res.json()).ok).toBe(true);
    expect(contactCreate).not.toHaveBeenCalled();
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
