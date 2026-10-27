// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = { id: string; status: string; recipient: string | null; callId: number; attempts: number; claimedAt: Date; txHash: string | null; submittedAt: Date | null; mintedAt: Date | null; lastError: string | null };
let rows: Row[] = [];
let leaseFree = true;

const matches = (r: Row, where: Record<string, unknown> = {}): boolean => {
  for (const [k, v] of Object.entries(where)) {
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
      findMany: vi.fn(async (a: { where: Record<string, unknown>; take?: number }) => rows.filter((r) => matches(r, a.where)).slice(0, a.take ?? 1e9)),
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
  getMaxFeePerGas: vi.fn(),
  sendMintMany: vi.fn(),
  waitForReceipt: vi.fn(),
  getReceiptState: vi.fn(),
  isClaimUsed: vi.fn(),
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
  id, status: "QUEUED", recipient: ADDR, callId: 1, attempts: 0, claimedAt: new Date(Date.now() - 1000), txHash: null, submittedAt: null, mintedAt: null, lastError: null, ...over,
});

const saved = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  leaseFree = true;
  Object.assign(process.env, { SLICES_ENABLED: "true", SLICES_CONTRACT_ADDRESS: ADDR, SLICES_MINTER_PRIVATE_KEY: "k", BASE_RPC_URL: "https://rpc" });
  delete process.env.SLICES_DAILY_CAP;
  minter.getMinterBalance.mockResolvedValue(BigInt("20000000000000000"));
  minter.getMaxFeePerGas.mockResolvedValue(BigInt(6_000_000)); // 0.006 gwei
  minter.sendMintMany.mockResolvedValue("0xhash");
  minter.waitForReceipt.mockResolvedValue({ state: "success" });
  minter.getReceiptState.mockResolvedValue("pending");
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
    minter.getMaxFeePerGas.mockResolvedValue(BigInt(2_000_000_000)); // 2 gwei
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
      minter.getReceiptState.mockResolvedValue("success");
      rows = [mk("a", { status: "SUBMITTED", txHash: "0xt", submittedAt: new Date() })];
      await processMintQueue();
      expect(rows[0].status).toBe("MINTED");
    });

    it("a reverted tx whose claim key is used on-chain is MINTED", async () => {
      minter.getReceiptState.mockResolvedValue("reverted");
      minter.isClaimUsed.mockResolvedValue(true);
      rows = [mk("a", { status: "SUBMITTED", txHash: "0xt", submittedAt: new Date() })];
      await processMintQueue();
      expect(rows[0].status).toBe("MINTED");
    });

    it("a reverted tx with an unused key is requeued", async () => {
      minter.getReceiptState.mockResolvedValue("reverted");
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

    it("a young pending tx is left alone", async () => {
      rows = [mk("a", { status: "SUBMITTED", txHash: "0xt", submittedAt: new Date() })];
      await processMintQueue();
      expect(rows[0].status).toBe("SUBMITTED");
      expect(minter.isClaimUsed).not.toHaveBeenCalled();
    });
  });
});
