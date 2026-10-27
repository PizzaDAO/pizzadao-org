// Call Slices mint queue. One run = take the single minter lease (one row PER CHAIN),
// reconcile in-flight transactions, check the spend guards, then send a mintMany batch.
// The lease means exactly one sender at a time, so parallel serverless invocations
// cannot clash on the minter's nonce. Idempotency is double-layered: the DB unique
// (discordId, callId) and the on-chain claim key.
//
// Every query is filtered by the configured chain id (claims are stamped with it at
// creation), and minting only runs on a production deploy (see slicesReady), because
// Vercel previews share the production database.
import { randomUUID } from "crypto";
import type { Hex } from "viem";
import { prisma } from "@/app/lib/db";
import { dailyCap, maxGasGwei, minBalanceWei, planFees, sliceChain, SLICES_BATCH_SIZE, SLICES_MAX_ATTEMPTS, slicesReady } from "./config";
import { claimKeyFor, getFeeQuote, getMinterBalance, getReceiptInfo, isClaimUsed, replaceStuckTx, scrubError, sendMintMany, waitForReceipt } from "./minter";
import { postSliceAlert } from "./alerts";

const LEASE_MS = 90_000;
const STUCK_AFTER_MS = 10 * 60_000;
export const RECONCILE_LIMIT = 25;
const RUN_BUDGET_MS = 50_000;

export type QueueResult =
  | { status: "skipped"; reason: "disabled" | "misconfigured" | "not_production" | "busy" | "low_balance" | "daily_cap" | "gas_too_high" | "nothing_to_do" | "rpc_error"; reconciled?: number }
  | { status: "ran"; reconciled: number; submitted: number; minted: number; txHash?: string };

const chainId = () => sliceChain().id;

async function acquireLease(holder: string): Promise<boolean> {
  const until = new Date(Date.now() + LEASE_MS);
  const id = chainId();
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    INSERT INTO "SliceMintLease" ("id", "holder", "leaseUntil") VALUES (${id}, ${holder}, ${until})
    ON CONFLICT ("id") DO UPDATE SET "holder" = ${holder}, "leaseUntil" = ${until}
    WHERE "SliceMintLease"."leaseUntil" < now()
    RETURNING "id"`;
  return rows.length > 0;
}

/** Heartbeat: push the lease out again before each send so a long run keeps its lock. */
async function extendLease(holder: string): Promise<void> {
  await prisma.sliceMintLease.updateMany({ where: { id: chainId(), holder }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) } }).catch(() => undefined);
}

async function releaseLease(holder: string): Promise<void> {
  await prisma.sliceMintLease.updateMany({ where: { id: chainId(), holder }, data: { leaseUntil: new Date(0) } }).catch(() => undefined);
}

const looksPermanent = (msg: string) => /revert|exceeds block gas|invalid argument/i.test(msg);

type Settle = { id: string };

/**
 * A mined successful tx: rows whose SliceMinted event is in the logs are MINTED. Others were skipped by the
 * contract (recipient already held the slice, or the key was used by an earlier tx): MINTED if the key is
 * used on-chain, otherwise SKIPPED_ALREADY_HELD with a note.
 */
async function settleSuccess(rows: Settle[], mintedKeys: Set<string> | undefined, now = new Date()): Promise<number> {
  let minted = 0;
  for (const r of rows) {
    const key = claimKeyFor(r.id).toLowerCase();
    let ok = !mintedKeys || mintedKeys.has(key);
    if (!ok) ok = await isClaimUsed(claimKeyFor(r.id)).catch(() => false);
    await prisma.attendanceNftClaim.update({
      where: { id: r.id },
      data: ok
        ? { status: "MINTED", mintedAt: now, lastError: null }
        : { status: "SKIPPED_ALREADY_HELD", mintedAt: now, lastError: "recipient already held this slice; nothing new was minted" },
    });
    if (ok) minted++;
  }
  return minted;
}

/** Move SUBMITTED claims to MINTED, replace stuck txs, or put them back in the queue. */
export async function reconcileSubmitted(now = new Date()): Promise<number> {
  const rows = await prisma.attendanceNftClaim.findMany({
    where: { status: "SUBMITTED", chainId: chainId(), txHash: { not: null } },
    orderBy: { submittedAt: "asc" },
    select: { id: true, txHash: true, submittedAt: true, attempts: true },
    take: RECONCILE_LIMIT,
  });
  let changed = 0;
  const byHash = new Map<string, typeof rows>();
  for (const r of rows) byHash.set(r.txHash!, [...(byHash.get(r.txHash!) ?? []), r]);

  for (const [hash, group] of byHash) {
    const info = await getReceiptInfo(hash as Hex);
    if (info.state === "success") {
      await settleSuccess(group, info.mintedKeys, now);
      changed += group.length;
      continue;
    }
    const stuck = group.every((g) => !g.submittedAt || now.getTime() - g.submittedAt.getTime() > STUCK_AFTER_MS);
    if (info.state === "pending" && !stuck) continue;

    if (info.state === "pending") {
      // Stuck in the mempool: replace at the same nonce with a bumped fee before giving up on it.
      const ceiling = BigInt(Math.floor(maxGasGwei() * 1e9));
      const replacement = await replaceStuckTx(hash as Hex, ceiling).catch((e) => {
        console.error("[slices] replace failed:", scrubError(e));
        return null;
      });
      if (replacement) {
        await prisma.attendanceNftClaim.updateMany({ where: { id: { in: group.map((g) => g.id) } }, data: { txHash: replacement, submittedAt: now } });
        changed += group.length;
        continue;
      }
    }

    // Reverted, or dropped: the claim key tells us whether the mint really happened.
    for (const g of group) {
      const used = await isClaimUsed(claimKeyFor(g.id)).catch(() => null);
      if (used === null) continue; // RPC trouble: decide next run
      if (used) {
        await prisma.attendanceNftClaim.update({ where: { id: g.id }, data: { status: "MINTED", mintedAt: now, lastError: null } });
      } else if (info.state === "pending") {
        // A stuck/dropped tx is not the claim's fault: give the attempt back so requeue cycles don't burn it.
        await prisma.attendanceNftClaim.update({ where: { id: g.id }, data: { status: "QUEUED", txHash: null, attempts: Math.max(0, g.attempts - 1), lastError: "tx dropped; requeued" } });
      } else {
        await prisma.attendanceNftClaim.update({
          where: { id: g.id },
          data: g.attempts >= SLICES_MAX_ATTEMPTS ? { status: "FAILED", lastError: "tx reverted" } : { status: "QUEUED", txHash: null, lastError: "tx reverted; requeued" },
        });
      }
      changed++;
    }
  }
  return changed;
}

/** Mints already sent in the last 24h (rolling) on this chain, for the daily cap. */
export async function mintedLast24h(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return prisma.attendanceNftClaim.count({
    where: { status: { in: ["SUBMITTED", "MINTED"] }, chainId: chainId(), OR: [{ submittedAt: { gte: since } }, { mintedAt: { gte: since } }] },
  });
}

type Batch = { id: string; recipient: string | null; callId: number }[];
type Totals = { submitted: number; minted: number; txHash?: string };

/** Persist the tx hash right after broadcast; never lose it even if the first write fails. */
async function markSubmitted(ids: string[], hash: Hex): Promise<void> {
  try {
    await prisma.attendanceNftClaim.updateMany({
      where: { id: { in: ids } },
      data: { status: "SUBMITTED", txHash: hash, chainId: chainId(), submittedAt: new Date(), lastError: null },
    });
  } catch (e) {
    console.error("[slices] failed to record submitted tx", hash, scrubError(e));
    try {
      await prisma.attendanceNftClaim.updateMany({ where: { id: { in: ids } }, data: { status: "SUBMITTED", txHash: hash } });
    } catch (e2) {
      console.error("[slices] fallback write failed for tx", hash, scrubError(e2));
    }
  }
}

/**
 * Send one mintMany. If the node rejects it with a revert-like error and the batch has more than one row,
 * bisect so only the bad row ends up FAILED. Transient errors (RPC, nonce) leave rows QUEUED for the next run.
 */
async function sendBatch(batch: Batch, fees: { maxFee: bigint; priority: bigint }, holder: string, deadline: number): Promise<Totals> {
  const zero: Totals = { submitted: 0, minted: 0 };
  if (Date.now() > deadline) return zero;
  await extendLease(holder);
  const ids = batch.map((b) => b.id);
  let hash: Hex;
  try {
    hash = await sendMintMany(
      batch.map((b) => ({ to: b.recipient as `0x${string}`, id: b.callId, key: claimKeyFor(b.id) })),
      fees,
    );
  } catch (e) {
    const msg = scrubError(e);
    console.error("[slices] send failed:", msg);
    if (looksPermanent(msg)) {
      if (batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        const a = await sendBatch(batch.slice(0, mid), fees, holder, deadline);
        const b = await sendBatch(batch.slice(mid), fees, holder, deadline);
        return { submitted: a.submitted + b.submitted, minted: a.minted + b.minted, txHash: b.txHash ?? a.txHash };
      }
      await prisma.attendanceNftClaim.updateMany({ where: { id: { in: ids } }, data: { status: "FAILED", lastError: msg } });
      return zero;
    }
    await prisma.attendanceNftClaim.updateMany({ where: { id: { in: ids } }, data: { lastError: msg } });
    return zero;
  }
  await markSubmitted(ids, hash);
  const receipt = await waitForReceipt(hash);
  let minted = 0;
  if (receipt.state === "success") minted = await settleSuccess(batch, receipt.mintedKeys);
  // reverted / still pending: the next run's reconcile decides
  return { submitted: batch.length, minted, txHash: hash };
}

export async function processMintQueue(): Promise<QueueResult> {
  const ready = slicesReady();
  if (!ready.ok) return { status: "skipped", reason: ready.reason };

  const holder = randomUUID();
  if (!(await acquireLease(holder))) return { status: "skipped", reason: "busy" };
  const deadline = Date.now() + RUN_BUDGET_MS;
  try {
    const reconciled = await reconcileSubmitted().catch((e) => {
      console.error("[slices] reconcile failed:", scrubError(e));
      return 0;
    });

    // ---- guards ----
    let balance: bigint;
    try {
      balance = await getMinterBalance();
    } catch (e) {
      console.error("[slices] balance check failed:", scrubError(e));
      return { status: "skipped", reason: "rpc_error", reconciled };
    }
    if (balance < minBalanceWei()) {
      await postSliceAlert(`minter balance is low (${(Number(balance) / 1e18).toFixed(5)} ETH). Minting is paused until it is topped up.`);
      return { status: "skipped", reason: "low_balance", reconciled };
    }
    const cap = dailyCap();
    const remaining = cap - (await mintedLast24h());
    if (remaining <= 0) {
      await postSliceAlert(`daily mint cap (${cap}) reached. Queue is paused until the 24h window rolls.`);
      return { status: "skipped", reason: "daily_cap", reconciled };
    }

    // Out of attempts: surface on the admin page instead of retrying forever.
    await prisma.attendanceNftClaim.updateMany({
      where: { status: "QUEUED", chainId: chainId(), attempts: { gte: SLICES_MAX_ATTEMPTS } },
      data: { status: "FAILED" },
    });
    const queued: Batch = await prisma.attendanceNftClaim.findMany({
      where: { status: "QUEUED", chainId: chainId(), attempts: { lt: SLICES_MAX_ATTEMPTS } },
      orderBy: { claimedAt: "asc" },
      take: Math.min(SLICES_BATCH_SIZE, remaining),
      select: { id: true, recipient: true, callId: true },
    });
    if (queued.length === 0) return { status: "skipped", reason: "nothing_to_do", reconciled };

    const noWallet = queued.filter((q) => !q.recipient);
    if (noWallet.length) {
      await prisma.attendanceNftClaim.updateMany({ where: { id: { in: noWallet.map((q) => q.id) } }, data: { status: "AWAITING_WALLET" } });
    }
    const batch = queued.filter((q) => q.recipient);
    if (batch.length === 0) return { status: "skipped", reason: "nothing_to_do", reconciled };

    let fees: { maxFee: bigint; priority: bigint } | null;
    try {
      const q = await getFeeQuote();
      fees = planFees(q.baseFee, q.priority, maxGasGwei());
    } catch (e) {
      console.error("[slices] fee estimate failed:", scrubError(e));
      return { status: "skipped", reason: "rpc_error", reconciled };
    }
    if (!fees) return { status: "skipped", reason: "gas_too_high", reconciled };

    // ---- send ----
    await prisma.attendanceNftClaim.updateMany({ where: { id: { in: batch.map((b) => b.id) } }, data: { attempts: { increment: 1 } } });
    const totals = await sendBatch(batch, fees, holder, deadline);
    return { status: "ran", reconciled, submitted: totals.submitted, minted: totals.minted, ...(totals.txHash ? { txHash: totals.txHash } : {}) };
  } finally {
    await releaseLease(holder);
  }
}

/** Never throws. Bounded: returns after `timeoutMs` even if the run is still going (the lease protects it). */
export async function processMintQueueSafe(timeoutMs = 40_000): Promise<void> {
  const run = processMintQueue().then(
    () => undefined,
    (e) => console.error("[slices] queue run failed:", scrubError(e)),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([run, timeout]);
  if (timer) clearTimeout(timer);
}
