// @vitest-environment node
import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signConfirm, signUnsubscribe, verifyConfirm, verifyUnsubscribe } from "@/app/lib/reengage/unsub-sig";
import {
  confirmIssuedAt,
  NEWSLETTER_CONFIRM_TTL_MS,
  newsletterConfirmPageUrl,
  newsletterUnsubPageUrl,
  newsletterUnsubPostUrl,
  signNewsletterConfirm,
  signNewsletterUnsub,
  verifyNewsletterConfirm,
  verifyNewsletterUnsub,
} from "./sig";

const KEY = "test-secret";
const hmac = (payload: string) => createHmac("sha256", KEY).update(payload).digest("base64url");
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = { u: process.env.UNSUBSCRIBE_SECRET, s: process.env.SESSION_SECRET };
  process.env.UNSUBSCRIBE_SECRET = KEY;
});
afterEach(() => {
  if (saved.u === undefined) delete process.env.UNSUBSCRIBE_SECRET;
  else process.env.UNSUBSCRIBE_SECRET = saved.u;
  if (saved.s === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = saved.s;
});

describe("reengage signatures stay byte-identical after the generalization", () => {
  it("unsubscribe signs exactly 'reengage-unsub-v1\\n<memberId>'", () => {
    expect(signUnsubscribe("m42")).toBe(hmac("reengage-unsub-v1\nm42"));
    expect(verifyUnsubscribe("m42", hmac("reengage-unsub-v1\nm42"))).toBe(true);
  });

  it("confirm signs exactly 'reengage-confirm-v1\\n<memberId>\\n<lowercased email>\\n<exp>'", () => {
    const now = 1_800_000_000_000;
    const token = signConfirm("m42", " A@Example.org ", now)!;
    const exp = now + 7 * 24 * 60 * 60 * 1000;
    expect(token).toBe(`${exp}.${hmac(`reengage-confirm-v1\nm42\na@example.org\n${exp}`)}`);
    expect(verifyConfirm("m42", "a@example.org", token, now)).toBe(true);
  });

  it("an empty member id still signs nothing", () => {
    expect(signUnsubscribe("")).toBeNull();
  });
});

describe("newsletter signatures", () => {
  it("unsubscribe uses its own domain string and never expires", () => {
    expect(signNewsletterUnsub("sub1")).toBe(hmac("newsletter-unsub-v1\nsub1"));
    expect(verifyNewsletterUnsub("sub1", hmac("newsletter-unsub-v1\nsub1"))).toBe(true);
    expect(verifyNewsletterUnsub("sub2", signNewsletterUnsub("sub1"))).toBe(false);
    expect(verifyNewsletterUnsub("sub1", undefined)).toBe(false);
    expect(verifyNewsletterUnsub("", signNewsletterUnsub("sub1"))).toBe(false);
  });

  it("confirm uses its own domain string, binds the address and expires in 7 days", () => {
    const now = 1_800_000_000_000;
    const token = signNewsletterConfirm("sub1", "A@Example.org", now)!;
    const exp = now + NEWSLETTER_CONFIRM_TTL_MS;
    expect(token).toBe(`${exp}.${hmac(`newsletter-confirm-v1\nsub1\na@example.org\n${exp}`)}`);
    expect(verifyNewsletterConfirm("sub1", "a@example.org", token, now)).toEqual({ exp });
    expect(confirmIssuedAt(exp)).toBe(now);
    expect(verifyNewsletterConfirm("sub1", "other@example.org", token, now)).toBeNull();
    expect(verifyNewsletterConfirm("sub2", "a@example.org", token, now)).toBeNull();
    expect(verifyNewsletterConfirm("sub1", "a@example.org", token, exp + 1)).toBeNull();
    expect(verifyNewsletterConfirm("sub1", "a@example.org", "garbage", now)).toBeNull();
  });

  it("domains are separated: digest links never verify as newsletter links and back", () => {
    expect(verifyNewsletterUnsub("x1", signUnsubscribe("x1"))).toBe(false);
    expect(verifyUnsubscribe("x1", signNewsletterUnsub("x1"))).toBe(false);
    const now = Date.now();
    expect(verifyNewsletterConfirm("x1", "a@example.org", signConfirm("x1", "a@example.org", now), now)).toBeNull();
    expect(verifyConfirm("x1", "a@example.org", signNewsletterConfirm("x1", "a@example.org", now), now)).toBe(false);
  });

  it("builds absolute links", () => {
    const base = "https://app.example.org";
    expect(newsletterUnsubPageUrl("sub1", base)).toBe(`${base}/newsletter/unsubscribe?s=sub1&sig=${signNewsletterUnsub("sub1")}`);
    expect(newsletterUnsubPostUrl("sub1", base)).toBe(`${base}/api/public/newsletter/unsubscribe?s=sub1&sig=${signNewsletterUnsub("sub1")}`);
    expect(newsletterConfirmPageUrl("sub1", "1.abc", base)).toBe(`${base}/newsletter/confirm?s=sub1&t=1.abc`);
  });

  it("signs nothing without a secret", () => {
    delete process.env.UNSUBSCRIBE_SECRET;
    delete process.env.SESSION_SECRET;
    expect(signNewsletterUnsub("sub1")).toBeNull();
    expect(signNewsletterConfirm("sub1", "a@example.org")).toBeNull();
  });
});
