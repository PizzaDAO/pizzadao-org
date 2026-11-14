// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/db", () => ({ prisma: {} }));

import { SETTINGS } from "@/app/lib/settings/registry";
import { isToggleKey } from "@/app/lib/settings/toggles";
import { settingIsOn } from "./switches";

const snapshot = (over: Record<string, unknown> = {}) =>
  ({
    readFailed: false,
    invalidKeys: [] as string[],
    isSet: (k: string) => k in over,
    get: (k: string) => (k in over ? over[k] : (SETTINGS as Record<string, { default: unknown }>)[k].default),
  }) as never;

const prod = { VERCEL_ENV: "production" };

describe("settingIsOn", () => {
  it("resolves a TOGGLES key with the usual rules (saved value in production, env kill wins)", () => {
    expect(settingIsOn("calls.dstFixEnabled", snapshot(), prod)).toBe(false);
    expect(settingIsOn("calls.dstFixEnabled", snapshot({ "calls.dstFixEnabled": true }), prod)).toBe(true);
    expect(settingIsOn("calls.dstFixEnabled", snapshot({ "calls.dstFixEnabled": true }), { ...prod, CALL_DST_FIX_ENABLED: "0" })).toBe(false);
  });

  it("reads a 0/1 setting such as passport.enabled", () => {
    expect(settingIsOn("passport.enabled", snapshot(), prod)).toBe(false);
    expect(settingIsOn("passport.enabled", snapshot({ "passport.enabled": 1 }), prod)).toBe(true);
  });

  it("never lets a saved ON reach a preview for a non-toggle setting", () => {
    expect(settingIsOn("passport.enabled", snapshot({ "passport.enabled": 1 }), { VERCEL_ENV: "preview" })).toBe(false);
  });

  it("fails closed when settings cannot be read, and answers null for unknown keys", () => {
    expect(settingIsOn("passport.enabled", { ...(snapshot() as object), readFailed: true } as never, prod)).toBe(false);
    expect(settingIsOn("no.such.key", snapshot(), prod)).toBeNull();
  });
});

describe("features settings", () => {
  it("the four switches are toggles and default off", () => {
    for (const k of ["features.publicEnabled", "features.exportEnabled", "features.navLinkEnabled", "features.showOps"] as const) {
      expect(isToggleKey(k)).toBe(true);
      expect(SETTINGS[k].default).toBe(false);
    }
  });

  it("the text settings default empty and the cache default is 60 minutes", () => {
    expect(SETTINGS["features.introText"].default).toBe("");
    expect(SETTINGS["features.contributeUrl"].default).toBe("");
    expect(SETTINGS["features.githubCacheMinutes"].default).toBe(60);
    expect(SETTINGS["features.contributeUrl"].schema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(SETTINGS["features.contributeUrl"].schema.safeParse("https://discord.example/x").success).toBe(true);
  });
});
