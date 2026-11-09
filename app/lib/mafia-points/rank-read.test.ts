// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const upsert = vi.fn(async () => undefined);
vi.mock("@/app/lib/db", () => ({
  prisma: { mafiaRankCache: { findUnique: (...a: unknown[]) => findUnique(...a), upsert: (...a: unknown[]) => upsert(...(a as [])) } },
}));
vi.mock("@/app/lib/discord", () => ({ fetchGuildMember: vi.fn() }));
vi.mock("@/app/lib/nft", () => ({ fetchPizzaDAONFTs: vi.fn() }));
vi.mock("@/app/lib/poap", () => ({ fetchFilteredPOAPs: vi.fn() }));
const fetchMemberById = vi.fn();
vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberById: (...a: unknown[]) => fetchMemberById(...a) }));
const cacheGetOrSet = vi.fn();
vi.mock("@/app/api/lib/cache", () => ({ cacheGetOrSet: (...a: unknown[]) => cacheGetOrSet(...a) }));
vi.mock("@/app/lib/settings", () => ({ loadSettings: vi.fn(async () => undefined) }));

import { getMafiaRank } from "./index";

const HOUR = 3600_000;
beforeEach(() => {
  vi.clearAllMocks();
});

describe("getMafiaRank read path", () => {
  it("serves a fresh precomputed row without any live lookup", async () => {
    findUnique.mockResolvedValue({ points: 0, memberName: "Tony", computedAt: new Date(Date.now() - HOUR) });
    const r = await getMafiaRank("7");
    expect(r.memberName).toBe("Tony");
    expect(typeof r.rank.name).toBe("string");
    expect(cacheGetOrSet).not.toHaveBeenCalled();
    expect(fetchMemberById).not.toHaveBeenCalled();
  });

  it("falls back to the live path (and stores the result) when the row is missing", async () => {
    findUnique.mockResolvedValue(null);
    cacheGetOrSet.mockResolvedValue({ memberId: "7", memberName: "Tony", totalPoints: 0, breakdown: [], lastCalculated: 1 });
    const r = await getMafiaRank("7");
    expect(cacheGetOrSet).toHaveBeenCalledTimes(1);
    expect(r.memberName).toBe("Tony");
    await Promise.resolve();
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("falls back to the live path when the row is older than 26 hours", async () => {
    findUnique.mockResolvedValue({ points: 0, memberName: "Old", computedAt: new Date(Date.now() - 27 * HOUR) });
    cacheGetOrSet.mockResolvedValue({ memberId: "7", memberName: "Tony", totalPoints: 0, breakdown: [], lastCalculated: 1 });
    const r = await getMafiaRank("7");
    expect(cacheGetOrSet).toHaveBeenCalledTimes(1);
    expect(r.memberName).toBe("Tony");
  });

  it("falls back to the live path when the table cannot be read", async () => {
    findUnique.mockRejectedValue(new Error("relation does not exist"));
    cacheGetOrSet.mockResolvedValue({ memberId: "7", memberName: "Tony", totalPoints: 0, breakdown: [], lastCalculated: 1 });
    const r = await getMafiaRank("7");
    expect(r.memberName).toBe("Tony");
  });
});
