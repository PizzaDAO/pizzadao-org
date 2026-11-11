// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();
const findUnique = vi.fn();
const upsert = vi.fn();
vi.mock("@/app/lib/db", () => ({
  prisma: {
    memberCollectionStats: {
      findMany: (...a: unknown[]) => findMany(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      upsert: (...a: unknown[]) => upsert(...a),
    },
  },
}));
vi.mock("@/app/lib/settings", () => ({ loadSettings: vi.fn(async () => undefined) }));
const wallets = vi.fn();
vi.mock("@/app/lib/wallet-lookup", () => ({
  getEvmWalletsForMember: (...a: unknown[]) => wallets(...a),
  getWalletForMember: vi.fn(async () => null),
}));
vi.mock("@/app/lib/poap", () => ({
  fetchFilteredPOAPs: vi.fn(async (w: string) => ({
    poaps: w === "0xa" ? [{ tokenId: 1 }, { tokenId: 2 }] : [{ tokenId: 2 }, { tokenId: 3 }],
    totalCount: 2,
    fromCache: true,
  })),
}));
vi.mock("@/app/lib/nft", () => ({
  fetchPizzaDAONFTs: vi.fn(async () => ({
    nfts: [
      { chain: "eth", contractAddress: "0xc1", tokenId: "1" },
      { chain: "eth", contractAddress: "0xc1", tokenId: "2" },
      { chain: "base", contractAddress: "0xc2", tokenId: "1" },
    ],
    totalCount: 3,
    walletAddress: "x",
  })),
}));
vi.mock("@/app/lib/unlock/scan", () => ({ getTicketSummary: vi.fn(async () => ({ totalTickets: 2 })) }));
vi.mock("@/app/lib/mafia-points/precompute", () => ({
  listRankableMemberIds: vi.fn(async () => ["1", "2", "3"]),
  orderOldestFirst: (ids: string[], m: Map<string, number>) =>
    [...ids].sort((a, b) => (m.get(a) ?? 0) - (m.get(b) ?? 0)),
}));

import { computeCollectionStats, refreshCollectionStats, isStale } from "./index";
import { runCollectionStatsPrecompute } from "./precompute";

beforeEach(() => {
  vi.clearAllMocks();
  wallets.mockResolvedValue(["0xa", "0xb"]);
});

describe("computeCollectionStats", () => {
  it("dedupes POAPs and NFTs across wallets and counts collections", async () => {
    expect(await computeCollectionStats("1")).toEqual({
      poapCount: 3,
      nftCount: 3,
      nftCollections: 2,
      ticketCount: 2,
      hasWallet: true,
    });
  });
  it("without a wallet still reports tickets", async () => {
    wallets.mockResolvedValue([]);
    expect(await computeCollectionStats("1")).toEqual({
      poapCount: 0,
      nftCount: 0,
      nftCollections: 0,
      ticketCount: 2,
      hasWallet: false,
    });
  });
});

describe("refreshCollectionStats", () => {
  it("upserts the computed numbers and returns them even if the write fails", async () => {
    upsert.mockRejectedValueOnce(new Error("no table"));
    const s = await refreshCollectionStats("1");
    expect(s?.poapCount).toBe(3);
    expect(upsert.mock.calls[0][0].where).toEqual({ memberId: "1" });
  });
});

describe("refresh safety", () => {
  it("writes nothing when an NFT lookup reports an error", async () => {
    const { fetchPizzaDAONFTs } = await import("@/app/lib/nft");
    (fetchPizzaDAONFTs as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ nfts: [], totalCount: 0, walletAddress: "x", error: "chain down" });
    await expect(refreshCollectionStats("1")).rejects.toThrow(/incomplete/);
    expect(upsert).not.toHaveBeenCalled();
  });
  it("is single-flight per member", async () => {
    const [a, b] = await Promise.all([refreshCollectionStats("9"), refreshCollectionStats("9")]);
    expect([a, b].filter((x) => x === null)).toHaveLength(1);
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});

describe("isStale", () => {
  it("compares against the freshness window", () => {
    const now = Date.now();
    expect(isStale(new Date(now - 3 * 3600_000), 2, now)).toBe(true);
    expect(isStale(new Date(now - 1 * 3600_000), 2, now)).toBe(false);
  });
});

describe("runCollectionStatsPrecompute", () => {
  it("refreshes oldest first and counts failures", async () => {
    findMany.mockResolvedValue([
      { memberId: "1", computedAt: new Date(900) },
      { memberId: "2", computedAt: new Date(100) },
    ]);
    const order: string[] = [];
    const res = await runCollectionStatsPrecompute({
      budgetMs: 1000,
      concurrency: 1,
      refresh: async (id) => {
        order.push(id);
        if (id === "2") throw new Error("boom");
      },
    });
    expect(order).toEqual(["3", "2", "1"]);
    expect(res).toEqual({ total: 3, computed: 2, failed: 1, remaining: 0, stoppedEarly: false });
  });
  it("stops at the time budget", async () => {
    findMany.mockResolvedValue([]);
    let t = 0;
    const res = await runCollectionStatsPrecompute({
      budgetMs: 15,
      concurrency: 1,
      now: () => t,
      refresh: async () => void (t += 10),
    });
    expect(res.computed).toBe(2);
    expect(res.remaining).toBe(1);
    expect(res.stoppedEarly).toBe(true);
  });
});
