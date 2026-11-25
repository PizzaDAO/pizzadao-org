// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db", () => ({ prisma: { triviaRound: { findMany: vi.fn() } } }));
vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberIdByDiscordId: vi.fn() }));

import { prisma } from "@/app/lib/db";
import { cachedRecentQuestionPosts, invalidateRecentQuestionPosts, reporterEligible } from "./reports";

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

describe("cachedRecentQuestionPosts", () => {
  const findMany = () => vi.mocked(prisma.triviaRound.findMany);
  beforeEach(() => {
    invalidateRecentQuestionPosts();
    findMany().mockReset();
    findMany().mockResolvedValue([{ messageId: "m2" }, { messageId: "m1" }] as never);
  });

  it("one query for repeated calls within 60 s, then a fresh one after", async () => {
    expect(await cachedRecentQuestionPosts("c", 1_000)).toEqual(["m2", "m1"]);
    expect(await cachedRecentQuestionPosts("c", 30_000)).toEqual(["m2", "m1"]);
    expect(findMany()).toHaveBeenCalledTimes(1);
    await cachedRecentQuestionPosts("c", 61_001);
    expect(findMany()).toHaveBeenCalledTimes(2);
  });

  it("concurrent calls share one in-flight query, and channels are cached separately", async () => {
    await Promise.all([cachedRecentQuestionPosts("c", 1_000), cachedRecentQuestionPosts("c", 1_000)]);
    expect(findMany()).toHaveBeenCalledTimes(1);
    await cachedRecentQuestionPosts("other", 1_000);
    expect(findMany()).toHaveBeenCalledTimes(2);
  });

  it("invalidate drops one channel (or all)", async () => {
    await cachedRecentQuestionPosts("c", 1_000);
    await cachedRecentQuestionPosts("d", 1_000);
    invalidateRecentQuestionPosts("c");
    await cachedRecentQuestionPosts("c", 2_000);
    await cachedRecentQuestionPosts("d", 2_000);
    expect(findMany()).toHaveBeenCalledTimes(3);
    invalidateRecentQuestionPosts();
    await cachedRecentQuestionPosts("d", 3_000);
    expect(findMany()).toHaveBeenCalledTimes(4);
  });

  it("a failed read is not cached", async () => {
    findMany().mockRejectedValueOnce(new Error("down"));
    await expect(cachedRecentQuestionPosts("c", 1_000)).rejects.toThrow("down");
    expect(await cachedRecentQuestionPosts("c", 2_000)).toEqual(["m2", "m1"]);
  });
});
