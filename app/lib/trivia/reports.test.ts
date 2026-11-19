// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("@/app/lib/db");
vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberIdByDiscordId: vi.fn() }));

import { reporterEligible } from "./reports";

const NOW = new Date("2026-12-10T15:00:00Z");
const OLD = "300000000000000000";
const YOUNG = String(BigInt(NOW.getTime() - 2 * 86_400_000 - 1420070400000) << BigInt(22));

describe("reporterEligible: the same two rules as winning, on every path", () => {
  it("an onboarded member on an old account is eligible", async () => {
    expect(await reporterEligible(OLD, NOW, async () => true)).toBe(true);
  });
  it("a non-member is not", async () => {
    expect(await reporterEligible(OLD, NOW, async () => false)).toBe(false);
  });
  it("a young account is not (and the member list is not even asked)", async () => {
    const isMember = vi.fn(async () => true);
    expect(await reporterEligible(YOUNG, NOW, isMember)).toBe(false);
    expect(isMember).not.toHaveBeenCalled();
  });
  it("an unreadable member list fails closed", async () => {
    expect(await reporterEligible(OLD, NOW, async () => { throw new Error("sheets down"); })).toBe(false);
  });
  it("a malformed id is not eligible", async () => {
    expect(await reporterEligible("nope", NOW, async () => true)).toBe(false);
  });
});
