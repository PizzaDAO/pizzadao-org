// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/db", () => ({ prisma: {} }));

import { SETTINGS } from "./registry";
import { MARKETING_SETTINGS } from "./marketing-settings";
import { resolveToggle } from "./toggles";

const snapshot = (over: Record<string, unknown> = {}) => ({
  readFailed: false,
  invalidKeys: [] as string[],
  isSet: (k: string) => k in over,
  get: (k: string) => (k in over ? over[k] : (SETTINGS as Record<string, { default: unknown }>)[k].default),
});

describe("marketing settings", () => {
  it("are registered under their own area", () => {
    for (const k of Object.keys(MARKETING_SETTINGS)) expect((SETTINGS as Record<string, { area: string }>)[k].area).toBe("marketing");
  });

  it("default to the safe state: switches off, no notify address, no calendar feed", () => {
    for (const k of ["marketing.newsletterEnabled", "marketing.contactEnabled", "marketing.calendarEnabled"] as const) {
      expect(SETTINGS[k].default).toBe(false);
    }
    expect(SETTINGS["marketing.contactNotifyEmail"].default).toBe("");
    expect(SETTINGS["marketing.calendarIcsUrl"].default).toBe("");
  });

  it("the text settings accept empty and valid values and reject bad ones", () => {
    const email = SETTINGS["marketing.contactNotifyEmail"].schema;
    expect(email.safeParse("").success).toBe(true);
    expect(email.safeParse("team@example.org").success).toBe(true);
    expect(email.safeParse("not an email").success).toBe(false);
    const url = SETTINGS["marketing.calendarIcsUrl"].schema;
    expect(url.safeParse("").success).toBe(true);
    expect(url.safeParse("https://example.org/a.ics").success).toBe(true);
    expect(url.safeParse("http://example.org/a.ics").success).toBe(false);
  });

  it("a switch needs the setting in production, and the env var turns it off or on on previews", () => {
    const prod = { VERCEL_ENV: "production" };
    expect(resolveToggle("marketing.contactEnabled", snapshot() as never, prod)).toBe(false);
    expect(resolveToggle("marketing.contactEnabled", snapshot({ "marketing.contactEnabled": true }) as never, prod)).toBe(true);
    expect(resolveToggle("marketing.contactEnabled", snapshot({ "marketing.contactEnabled": true }) as never, { ...prod, MARKETING_CONTACT_ENABLED: "0" })).toBe(false);
    const preview = { VERCEL_ENV: "preview" };
    expect(resolveToggle("marketing.contactEnabled", snapshot({ "marketing.contactEnabled": true }) as never, preview)).toBe(false);
    expect(resolveToggle("marketing.contactEnabled", snapshot() as never, { ...preview, MARKETING_CONTACT_ENABLED: "1" })).toBe(true);
  });
});
