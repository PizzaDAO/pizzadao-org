// @vitest-environment node
// The round lookups: one query for the channel's OPEN round, open vs lapsed decided in JS.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db", () => {
  const prisma = {
    triviaRound: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return { prisma };
});
vi.mock("@/app/lib/economy", () => ({ creditInTx: vi.fn(), getOrCreateEconomy: vi.fn() }));
vi.mock("@/app/lib/discord-rest", () => ({ DiscordPostError: class extends Error {}, postDiscordMessage: vi.fn() }));
vi.mock("./reports", () => ({ getDisabledIds: vi.fn(async () => []), invalidateRecentQuestionPosts: vi.fn() }));

import { prisma } from "@/app/lib/db";
import { getBank } from "./bank";
import { invalidateRecentQuestionPosts } from "./reports";
import { findChannelOpenRound, findLapsedRound, findOpenRound, isLapsed, openDiscordRound } from "./rounds";

const bankQuestions = (await getBank()).questions;
const tfQuestion = () => bankQuestions.find((q) => q.type === "true_false" && q.status === "approved")!;

const NOW = new Date("2026-12-10T15:00:00Z");
const row = (closesAt: Date) => ({ id: 1, questionId: "q", channelId: "c", messageId: "m", rewardPep: 20, openedAt: new Date(NOW.getTime() - 600_000), closesAt });
const findFirst = () => vi.mocked(prisma.triviaRound.findFirst);

beforeEach(() => findFirst().mockReset());

describe("round lookups", () => {
  it("findChannelOpenRound filters on OPEN only, with no close-time condition", async () => {
    findFirst().mockResolvedValueOnce(null);
    await findChannelOpenRound("c");
    expect(findFirst()).toHaveBeenCalledTimes(1);
    expect(findFirst().mock.calls[0][0]?.where).toEqual({ surface: "DISCORD", status: "OPEN", channelId: "c" });
  });

  it("isLapsed: closesAt <= now is lapsed", () => {
    expect(isLapsed({ closesAt: NOW }, NOW)).toBe(true);
    expect(isLapsed({ closesAt: new Date(NOW.getTime() - 1) }, NOW)).toBe(true);
    expect(isLapsed({ closesAt: new Date(NOW.getTime() + 1) }, NOW)).toBe(false);
  });

  it("findOpenRound returns an in-time round and not a lapsed one, one query each", async () => {
    const inTime = row(new Date(NOW.getTime() + 60_000));
    findFirst().mockResolvedValueOnce(inTime as never);
    expect(await findOpenRound("c", NOW)).toEqual(inTime);
    findFirst().mockResolvedValueOnce(row(new Date(NOW.getTime() - 60_000)) as never);
    expect(await findOpenRound("c", NOW)).toBeNull();
    expect(findFirst()).toHaveBeenCalledTimes(2);
  });

  it("findLapsedRound returns a lapsed round and not an in-time one", async () => {
    const lapsed = row(new Date(NOW.getTime() - 60_000));
    findFirst().mockResolvedValueOnce(lapsed as never);
    expect(await findLapsedRound("c", NOW)).toEqual(lapsed);
    findFirst().mockResolvedValueOnce(row(new Date(NOW.getTime() + 60_000)) as never);
    expect(await findLapsedRound("c", NOW)).toBeNull();
    findFirst().mockResolvedValueOnce(null);
    expect(await findLapsedRound("c", NOW)).toBeNull();
  });
});

describe("openDiscordRound drops the cached question posts", () => {
  const question = tfQuestion();
  beforeEach(() => {
    vi.mocked(invalidateRecentQuestionPosts).mockClear();
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ locked: true }] as never);
    vi.mocked(prisma.triviaRound.create).mockResolvedValue({ id: 5 } as never);
    vi.mocked(prisma.triviaRound.update).mockResolvedValue({} as never);
  });

  it("after the post id is stored", async () => {
    const r = await openDiscordRound({ channelId: "c", rewardPep: 20, now: NOW, question }, { post: vi.fn(async () => ({ id: "m9" })) });
    expect(r).toMatchObject({ ok: true, messageId: "m9" });
    expect(invalidateRecentQuestionPosts).toHaveBeenCalledWith("c");
  });

  it("not when no question was posted", async () => {
    await openDiscordRound({ channelId: "c", rewardPep: 20, now: NOW, question }, { post: vi.fn(async () => ({ id: null })) });
    expect(invalidateRecentQuestionPosts).not.toHaveBeenCalled();
  });
});
