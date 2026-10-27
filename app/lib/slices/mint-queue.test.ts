// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = { chainId: number | null; id: string; status: string; recipient: string | null; callId: number; attempts: number; claimedAt: Date; txHash: string | null; submittedAt: Date | null; mintedAt: Date | null; lastError: string | null };
let rows: Row[] = [];
let leaseFree = true;

const matches = (r: Row, where: Record<string, unknown> = {}): boolean => {
  for (const [k, v] of Object.entries(where)) {
    if (k === "AND") { if (!(v as Record<string, unknown>[]).every((w) => matches(r, w))) return false; continue; }
    if (k === "OR") { if (!(v as Record<string, unknown>[]).some((w) => matches(r, w))) return false; continue; }
    const val = (r as unknown as Record<string, unknown>)[k];
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const o = v as Record<string, unknown>;
      if ("in" in o && !(o.in as unknown[]).includes(val)) return false;
      if ("lt" in o && !(typeof val === "number" ? val < (o.lt as number) : (val as Date) < (o.lt as Date))) return false;
      if ("gte" in o && !(typeof val === "number" ? val >= (o.gte as number) : !!val && (val as Date) >= (o.gte as Date))) return false;
      if ("not" in o && val === o.not) return false;
    } else if (val !== v) return false;
  }
  return true;
};
const apply = (r: Row, data: Record<string, unknown>) => {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as object)) (r as unknown as Record<string, number>)[k] += (v as { increment: number }).increment;
    else (r as unknown as Record<string, unknown>)[k] = v;
  }
};

vi.mock("@/app/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn(async () => (leaseFree ? [{ id: 1 }] : [])),
    sliceMintLease: { updateMany: vi.fn(async () => ({ count: 1 })) },
    attendanceNftClaim: {
      findMany: vi.fn(async (a: { where: Record<string, unknown>; take?: number; distinct?: string[] }) => {
        let hit = rows.filter((r) => matches(r, a.where));
        if (a.distinct) {
          const seen = new Set<unknown>();
          hit = hit.filter((r) => { const v = (r as unknown as Record<string, unknown>)[a.distinct![0]]; if (seen.has(v)) return false; seen.add(v); return true; });
        }
        return hit.slice(0, a.take ?? 1e9);
      }),
      count: vi.fn(async (a: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, a.where)).length),
      updateMany: vi.fn(async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = rows.filter((r) => matches(r, a.where));
        hit.forEach((r) => apply(r, a.data));
        return { count: hit.length };
      }),
      update: vi.fn(async (a: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = rows.find((x) => x.id === a.where.id)!;
        apply(r, a.data);
        return r;
      }),
    },
  },
}));

const minter = vi.hoisted(() => ({
  getMinterBalance: vi.fn(),
  getFeeQuote: vi.fn(),
  sendMintMany: vi.fn(),
  waitForReceipt: vi.fn(),
  getReceiptInfo: vi.fn(),
  isClaimUsed: vi.fn(),
  replaceStuckTx: vi.fn(),
  checkMinterSetup: vi.fn(),
  getBalanceOf: vi.fn(),
}));
vi.mock("./minter", () => ({
  ...minter,
  claimKeyFor: (id: string) => `0xkey-${id}`,
  scrubError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
const alert = vi.hoisted(() => vi.fn(async () => true));
vi.mock("./alerts", () => ({ postSliceAlert: alert }));

import { processMintQueue } from "./mint-queue";

const ADDR = "0x" + "ab".repeat(20);
const mk = (id: string, over: Partial<Row> = {}): Row => ({
  chainId: 8453, id, status: "QUEUED", recipient: ADDR, callId: 1, attempts: 0, claimedAt: new Date(Date.now() - 1000), txHash: null, submittedAt: null, mintedAt: null, lastError: null, ...over,
});

const saved = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  leaseFree = true;
  Object.assign(process.env, { VERCEL_ENV: "production", SLICES_ENABLED: "true", SLICES_CONTRACT_ADDRESS: ADDR, SLICES_MINTER_PRIVATE_KEY: "k", BASE_RPC_URL: "https://rpc" });
  delete process.env.SLICES_DAILY_CAP;
  minter.getMinterBalance.mockResolvedValue(BigInt("20000000000000000"));
  minter.getFeeQuote.mockResolvedValue({ baseFee: BigInt(6_000_000), priority: BigInt(1_000_000) }); // 0.006 gwei base
  minter.sendMintMany.mockResolvedValue("0xhash");
  minter.waitForReceipt.mockResolvedValue({ state: "success" });
  minter.getReceiptInfo.mockResolvedValue({ state: "pending" });
  minter.replaceStuckTx.mockResolvedValue({ kind: "gone" });
  minter.checkMinterSetup.mockResolvedValue({ ok: true });
  minter.getBalanceOf.mockResolvedValue(BigInt(1));
  minter.isClaimUsed.mockResolvedValue(false);
});
afterEach(() => { process.env = { ...saved }; });

describe("processMintQueue", () => {
  it("does nothing while the kill switch is off", async () => {
    process.env.SLICES_ENABLED = "false";
    rows = [mk("a")];
    expect(await processMintQueue()).toEqual({ status: "skipped", reason: "disabled" });
    expect(minter.sendMintMany).not.toHaveBeenCalled();
    expect(rows[0].status).toBe("QUEUED");
  });

  it("refuses to mint outside a production deploy (previews share the prod DB)", async () => {
    process.env.VERCEL_ENV = "preview";
    rows = [mk("a")];
    expect(await processMintQueue()).toEqual({ status: "skipped", reason: "not_production" });
    expect(minter.sendMintMany).not.toHaveBeenCalled();
    process.env.SLICES_ALLOW_NON_PROD = "true"; // local dev override
    expect(await processMintQueue()).toMatchObject({ status: "ran" });
  });

  it("only touches claims on its own chain; NULL chainId rows count as the production chain", async () => {
    rows = [mk("a", { chainId: 84532 }), mk("b", { chainId: null }), mk("c")];
    const res = await processMintQueue();
    expect(res).toMatchObject({ status: "ran", submitted: 2 });
    expect(rows.map((r) => r.status)).toEqual(["QUEUED", "MINTED", "MINTED"]);
  });

  it("uses 2x base fee + tip as maxFee, capped by the gwei ceiling", async () => {
    rows = [mk("a")];
    await processMintQueue();
    expect(minter.sendMintMany.mock.calls[0][1]).toEqual({ maxFee: BigInt(13_000_000), priority: BigInt(1_000_000) });
  });

  it("only marks rows with a SliceMinted event as MINTED; others are SKIPPED_ALREADY_HELD", async () => {
    minter.waitForReceipt.mockResolvedValue({ state: "success", mintedKeys: new Set(["0xkey-a"]) });
    rows = [mk("a"), mk("b")];
    await processMintQueue();
    expect(rows.map((r) => r.status)).toEqual(["MINTED", "SKIPPED_ALREADY_HELD"]);
    expect(rows[1].lastError).toMatch(/already held/);
  });

  it("a shared failure (minter lost its role) holds the queue: no bisect, no FAILED, alert", async () => {
    minter.sendMintMany.mockRejectedValue(new Error("execution reverted: AccessControl"));
    minter.checkMinterSetup.mockResolvedValue({ ok: false, problem: "minter address does not hold MINTER_ROLE" });
    rows = [mk("a"), mk("b"), mk("c")];
    await processMintQueue();
    expect(minter.sendMintMany).toHaveBeenCalledTimes(1);
    expect(rows.map((r) => r.status)).toEqual(["QUEUED", "QUEUED", "QUEUED"]);
    expect(rows[0].lastError).toMatch(/MINTER_ROLE/);
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("aborts without sending when the lease was lost", async () => {
    const { prisma } = await import("@/app/lib/db");
    vi.mocked(prisma.sliceMintLease.updateMany).mockResolvedValueOnce({ count: 0 });
    rows = [mk("a")];
    await processMintQueue();
    expect(minter.sendMintMany).not.toHaveBeenCalled();
    expect(rows[0].status).toBe("QUEUED");
  });

  it("starts no new send once the cooperative budget is spent", async () => {
    rows = [mk("a")];
    await processMintQueue({ budgetMs: -1 });
    expect(minter.sendMintMany).not.toHaveBeenCalled();
  });

  it("leaves a row SUBMITTED when the settle read fails; FAILED when nothing was minted and nothing is held", async () => {
    minter.waitForReceipt.mockResolvedValue({ state: "success", mintedKeys: new Set() });
    minter.isClaimUsed.mockRejectedValueOnce(new Error("rpc"));
    rows = [mk("a")];
    await processMintQueue();
    expect(rows[0].status).toBe("SUBMITTED");

    minter.getBalanceOf.mockResolvedValue(BigInt(0));
    rows = [mk("b")];
    await processMintQueue();
    expect(rows[0].status).toBe("FAILED");
  });

  it("bisects a batch the node rejects so only the bad row is FAILED", async () => {
    minter.sendMintMany.mockImplementation(async (b: { key: string }[]) => {
      if (b.some((x) => x.key === "0xkey-bad")) throw new Error("execution reverted: boom");
      return "0xhash";
    });
    rows = [mk("a"), mk("bad"), mk("c"), mk("d")];
    await processMintQueue();
    expect(rows.map((r) => [r.id, r.status])).toEqual([["a", "MINTED"], ["bad", "FAILED"], ["c", "MINTED"], ["d", "MINTED"]]);
    expect(rows[1].lastError).toMatch(/reverted/);
  });

  it("does not bisect on transient errors", async () => {
    minter.sendMintMany.mockRejectedValue(new Error("fetch failed"));
    rows = [mk("a"), mk("b")];
    await processMintQueue();
    expect(minter.sendMintMany).toHaveBeenCalledTimes(1);
    expect(rows.map((r) => r.status)).toEqual(["QUEUED", "QUEUED"]);
  });

  it("keeps the tx hash even when the SUBMITTED write fails once", async () => {
    const { prisma } = await import("@/app/lib/db");
    const um = vi.mocked(prisma.attendanceNftClaim.updateMany);
    const orig = um.getMockImplementation()!;
    let failed = false;
    um.mockImplementation((async (a: { data: { status?: string } }) => {
      if (!failed && a.data.status === "SUBMITTED") { failed = true; throw new Error("db blip"); }
      return orig(a as never);
    }) as never);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rows = [mk("a")];
    await processMintQueue();
    spy.mockRestore();
    um.mockImplementation(orig);
    expect(rows[0].txHash).toBe("0xhash");
  });

  it("skips when env is incomplete", async () => {
    delete process.env.SLICES_MINTER_PRIVATE_KEY;
    expect(await processMintQueue()).toMatchObject({ status: "skipped", reason: "misconfigured" });
  });

  it("is single-flight: a second runner without the lease sends nothing", async () => {
    leaseFree = false;
    rows = [mk("a")];
    expect(await processMintQueue()).toEqual({ status: "skipped", reason: "busy" });
    expect(minter.sendMintMany).not.toHaveBeenCalled();
  });

  it("mints a batch in one transaction with per-claim keys and marks it MINTED", async () => {
    rows = [mk("a", { callId: 3 }), mk("b", { callId: 4 })];
    const res = await processMintQueue();
    expect(res).toMatchObject({ status: "ran", submitted: 2, minted: 2, txHash: "0xhash" });
    expect(minter.sendMintMany).toHaveBeenCalledTimes(1);
    expect(minter.sendMintMany.mock.calls[0][0]).toEqual([
      { to: ADDR, id: 3, key: "0xkey-a" },
      { to: ADDR, id: 4, key: "0xkey-b" },
    ]);
    expect(rows.map((r) => r.status)).toEqual(["MINTED", "MINTED"]);
    expect(rows[0].attempts).toBe(1);
  });

  it("leaves SUBMITTED when the receipt is still pending", async () => {
    minter.waitForReceipt.mockResolvedValue({ state: "pending" });
    rows = [mk("a")];
    await processMintQueue();
    expect(rows[0]).toMatchObject({ status: "SUBMITTED", txHash: "0xhash" });
  });

  it("pauses and alerts below the minimum balance", async () => {
    minter.getMinterBalance.mockResolvedValue(BigInt(1000));
    rows = [mk("a")];
    expect(await processMintQueue()).toMatchObject({ status: "skipped", reason: "low_balance" });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(minter.sendMintMany).not.toHaveBeenCalled();
  });

  it("enforces the daily cap and only sends what is left", async () => {
    process.env.SLICES_DAILY_CAP = "2";
    rows = [mk("m1", { status: "MINTED", mintedAt: new Date() }), mk("a"), mk("b")];
    const res = await processMintQueue();
    expect(res).toMatchObject({ status: "ran", submitted: 1 });
    expect(rows.filter((r) => r.status === "QUEUED")).toHaveLength(1);

    rows = [mk("m1", { status: "MINTED", mintedAt: new Date() }), mk("m2", { status: "SUBMITTED", submittedAt: new Date(), txHash: "0xz" }), mk("c")];
    minter.sendMintMany.mockClear();
    expect(await processMintQueue()).toMatchObject({ status: "skipped", reason: "daily_cap" });
    expect(alert).toHaveBeenCalled();
    expect(minter.sendMintMany).not.toHaveBeenCalled();
  });

  it("skips while gas is above the ceiling", async () => {
    minter.getFeeQuote.mockResolvedValue({ baseFee: BigInt(2_000_000_000), priority: BigInt(1_000_000) }); // 2 gwei
    rows = [mk("a")];
    expect(await processMintQueue()).toMatchObject({ status: "skipped", reason: "gas_too_high" });
    expect(minter.sendMintMany).not.toHaveBeenCalled();
  });

  it("moves claims with no recipient back to AWAITING_WALLET instead of sending", async () => {
    rows = [mk("a", { recipient: null })];
    await processMintQueue();
    expect(rows[0].status).toBe("AWAITING_WALLET");
    expect(minter.sendMintMany).not.toHaveBeenCalled();
  });

  it("records a send failure, keeps the claim queued and counts the attempt", async () => {
    minter.sendMintMany.mockRejectedValue(new Error("nonce too low"));
    rows = [mk("a")];
    await processMintQueue();
    expect(rows[0]).toMatchObject({ status: "QUEUED", attempts: 1, lastError: "nonce too low" });
  });

  it("marks claims FAILED once attempts are exhausted", async () => {
    rows = [mk("a", { attempts: 5 })];
    await processMintQueue();
    expect(rows[0].status).toBe("FAILED");
    expect(minter.sendMintMany).not.toHaveBeenCalled();
  });

  describe("reconcile", () => {
    const old = new Date(Date.now() - 20 * 60_000);
    it("confirms a successful receipt", async () => {
      minter.getReceiptInfo.mockResolvedValue({ state: "success" });
      rows = [mk("a", { status: "SUBMITTED", txHash: "0xt", submittedAt: new Date() })];
      await processMintQueue();
      expect(rows[0].status).toBe("MINTED");
    });

    it("a reverted tx whose claim key is used on-chain is MINTED", async () => {
      minter.getReceiptInfo.mockResolvedValue({ state: "reverted" });
      minter.isClaimUsed.mockResolvedValue(true);
      rows = [mk("a", { status: "SUBMITTED", txHash: "0xt", submittedAt: new Date() })];
      await processMintQueue();
      expect(rows[0].status).toBe("MINTED");
    });

    it("a reverted tx with an unused key is requeued", async () => {
      minter.getReceiptInfo.mockResolvedValue({ state: "reverted" });
      rows = [mk("a", { status: "SUBMITTED", txHash: "0xt", submittedAt: new Date(), attempts: 1 })];
      await processMintQueue();
      // requeued during reconcile, then sent again in the same run
      expect(minter.sendMintMany).toHaveBeenCalledTimes(1);
    });

    it("a tx pending past the stuck window falls back to the claim key", async () => {
      minter.isClaimUsed.mockResolvedValue(true);
      rows = [mk("a", { status: "SUBMITTED", txHash: "0xt", submittedAt: old })];
      await processMintQueue();
      expect(rows[0].status).toBe("MINTED");
    });

    it("replaces a stuck pending tx at the same nonce instead of requeueing it", async () => {
      minter.replaceStuckTx.mockResolvedValue({ kind: "replaced", hash: "0xnew" });
      rows = [mk("a", { status: "SUBMITTED", txHash: "0xt", submittedAt: old, attempts: 1 })];
      await processMintQueue();
      expect(rows[0]).toMatchObject({ status: "SUBMITTED", txHash: "0xnew", attempts: 1 });
      expect(minter.sendMintMany).not.toHaveBeenCalled();
    });

    it("a stuck tx that cannot be replaced stays SUBMITTED (no requeue) and raises an alert", async () => {
      minter.replaceStuckTx.mockResolvedValue({ kind: "still_pending" });
      rows = [mk("a", { status: "SUBMITTED", txHash: "0xt", submittedAt: old, attempts: 2 })];
      await processMintQueue();
      expect(rows[0]).toMatchObject({ status: "SUBMITTED", txHash: "0xt", attempts: 2 });
      expect(alert).toHaveBeenCalledTimes(1);
      expect(minter.isClaimUsed).not.toHaveBeenCalled();
    });

    it("reconciles every row of a hash even when the batch is larger than the reconcile limit", async () => {
      minter.getReceiptInfo.mockResolvedValue({ state: "success" });
      rows = Array.from({ length: 30 }, (_, i) => mk(`s${i}`, { status: "SUBMITTED", txHash: "0xsame", submittedAt: new Date() }));
      await processMintQueue();
      expect(rows.every((r) => r.status === "MINTED")).toBe(true);
    });

    it("a dropped tx that is requeued does not burn an attempt", async () => {
      process.env.SLICES_DAILY_CAP = "0.4"; // floor 0 -> daily_cap blocks the resend so we see the requeued row
      rows = [mk("a", { status: "SUBMITTED", txHash: "0xt", submittedAt: old, attempts: 2 })];
      await processMintQueue();
      expect(rows[0]).toMatchObject({ status: "QUEUED", attempts: 1, txHash: null });
    });

    it("reconciles at most 25 rows per run", async () => {
      minter.getReceiptInfo.mockResolvedValue({ state: "success" });
      rows = Array.from({ length: 30 }, (_, i) => mk(`s${i}`, { status: "SUBMITTED", txHash: `0xt${i}`, submittedAt: new Date() }));
      await processMintQueue();
      expect(rows.filter((r) => r.status === "MINTED")).toHaveLength(25);
    });

    it("a young pending tx is left alone", async () => {
      rows = [mk("a", { status: "SUBMITTED", txHash: "0xt", submittedAt: new Date() })];
      await processMintQueue();
      expect(rows[0].status).toBe("SUBMITTED");
      expect(minter.isClaimUsed).not.toHaveBeenCalled();
    });
  });
});
