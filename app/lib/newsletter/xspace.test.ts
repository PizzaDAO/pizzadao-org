import { describe, expect, it } from "vitest";
import { buildXSpace, DEFAULT_XSPACE, nextSpace, zonedInstant } from "./xspace";

const cfg = { ...DEFAULT_XSPACE };
// Issue dates are calendar days stored at noon UTC.
const day = (ymd: string) => new Date(`${ymd}T12:00:00.000Z`);

describe("X Space invite", () => {
  it("says today on the Space day", () => {
    const x = buildXSpace(day("2026-12-22"), cfg, "https://x.com/i/spaces/abc");
    expect(x.headline).toBe("Join our X Space today at 4:20pm ET");
    expect(x.detail).toBe("4:20pm ET is 21:20 UTC.");
    expect(x.url).toBe("https://x.com/i/spaces/abc");
    expect(x.enabled).toBe(true);
  });

  it("uses the date on any other day, before or after the Space day", () => {
    expect(buildXSpace(day("2026-12-18"), cfg, null).headline).toBe("Join our X Space on Tuesday, December 22 at 4:20pm ET");
    // After the 22nd the next Space is next month (and the year rolls over).
    expect(buildXSpace(day("2026-12-28"), cfg, null).headline).toBe("Join our X Space on Friday, January 22 at 4:20pm ET");
  });

  it("is DST-aware: the same wall clock is a different UTC time in summer", () => {
    expect(buildXSpace(day("2026-12-22"), cfg, null).detail).toContain("21:20 UTC"); // EST
    const summer = buildXSpace(day("2026-06-22"), cfg, null);
    expect(summer.headline).toBe("Join our X Space today at 4:20pm ET");
    expect(summer.detail).toContain("20:20 UTC"); // EDT
    expect(zonedInstant(2026, 3, 7, 4, 20, "America/New_York").toISOString()).toBe("2026-03-07T09:20:00.000Z"); // EST: UTC-5
    expect(zonedInstant(2026, 3, 9, 4, 20, "America/New_York").toISOString()).toBe("2026-03-09T08:20:00.000Z"); // EDT: UTC-4
  });

  it("falls back to the X profile when the issue has no Space link", () => {
    const withProfile = { ...cfg, profileUrl: "https://x.com/example" };
    expect(buildXSpace(day("2026-12-22"), withProfile, "").url).toBe("https://x.com/example");
    expect(buildXSpace(day("2026-12-22"), withProfile, "https://x.com/i/spaces/own").url).toBe("https://x.com/i/spaces/own");
    expect(buildXSpace(day("2026-12-22"), cfg, null).url).toBeNull();
  });

  it("respects the configured day and time", () => {
    const c = { ...cfg, dayOfMonth: 5, localTime: "09:05" };
    expect(nextSpace(day("2026-12-05"), c).today).toBe(true);
    expect(buildXSpace(day("2026-12-05"), c, null).headline).toBe("Join our X Space today at 9:05am ET");
  });

  it("carries the disabled flag", () => {
    expect(buildXSpace(day("2026-12-22"), { ...cfg, enabled: false }, null).enabled).toBe(false);
  });
});
