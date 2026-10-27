// Call Slices mint queue. One run = take the single minter lease, reconcile
// in-flight transactions, check the spend guards, then send ONE mintMany batch.
// The lease (a row in SliceMintLease) means exactly one sender at a time, so
// parallel serverless invocations cannot clash on the minter's nonce. Idempotency
// is double-layered: the DB unique (discordId, callId) and the on-chain claim key.
import { randomUUID } from "crypto";
import type { Hex } from "viem";
import { prisma } from "@/app/lib/db";
import { dailyCap, maxGasGwei, minBalanceWei, sliceChain, SLICES_BATCH_SIZE, SLICES_MAX_ATTEMPTS, slicesReady } from "./config";
import { claimKeyFor, getMaxFeePerGas, getMinterBalance, getReceiptState, isClaimUsed, scrubError, sendMintMany, waitForReceipt } from "./minter";
import { postSliceAlert } from "./alerts";

const LEASE_MS = 90_000;
const STUCK_AFTER_MS = 10 * 60_000;

export type QueueResult =
  | { status: "skipped"; reason: "disabled" | "misconfigured" | "busy" | "low_balance" | "daily_cap" | "gas_too_high" | "nothing_to_do" | "rpc_error"; reconciled?: number }
  | { status: "ran"; reconciled: number; submitted: number; minted: number; txHash?: string };

async function acquireLease(holder: string): Promise<boolean> {
  const until = new Date(Date.now() + LEASE_MS);
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    INSERT INTO "SliceMintLease" ("id", "holder", "leaseUntil") VALUES (1, ${holder}, ${until})
    ON CONFLICT ("id") DO UPDATE SET "holder" = ${holder}, "leaseUntil" = ${until}
    WHERE "SliceMintLease"."leaseUntil" < now()
    RETURNING "id"`;
  return rows.length > 0;
}

async function releaseLease(holder: string): Promise<void> {
  await prisma.sliceMintLease.updateMany({ where: { id: 1, holder }, data: { leaseUntil: new Date(0) } }).catch(() => undefined);
}

/** Move SUBMITTED claims to MINTED, or back to QUEUED when their tx failed/vanished. */
export async function reconcileSubmitted(now = new Date()): Promise<number> {
  const rows = await prisma.attendanceNftClaim.findMany({
    where: { status: "SUBMITTED", txHash: { not: null } },
    select: { id: true, txHash: true, submittedAt: true, attempts: true },
    take: 200,
  });
  let changed = 0;
  const byHash = new Map<string, typeof rows>();
  for (const r of rows) byHash.set(r.txHash!, [...(byHash.get(r.txHash!) ?? []), r]);

  for (const [hash, group] of byHash) {
    const state = await getReceiptState(hash as Hex);
    if (state === "success") {
      await prisma.attendanceNftClaim.updateMany({ where: { id: { in: group.map((g) => g.id) }, status: "SUBMITTED" }, data: { status: "MINTED", mintedAt: now, lastError: null } });
      changed += group.length;
      continue;
    }
    const stuck = group.every((g) => !g.submittedAt || now.getTime() - g.submittedAt.getTime() > STUCK_AFTER_MS);
    if (state === "pending" && !stuck) continue;
    // Reverted, or dropped/stuck: the claim key tells us whether the mint really happened.
    for (const g of group) {
      const used = await isClaimUsed(claimKeyFor(g.id)).catch(() => null);
      if (used === null) continue; // RPC trouble: decide next run
      if (used) {
        await prisma.attendanceNftClaim.update({ where: { id: g.id }, data: { status: "MINTED", mintedAt: now, lastError: null } });
      } else {
        await prisma.attendanceNftClaim.update({
          where: { id: g.id },
          data: g.attempts >= SLICES_MAX_ATTEMPTS
            ? { status: "FAILED", lastError: `tx ${state === "pending" ? "dropped" : "reverted"}` }
            : { status: "QUEUED", txHash: null, lastError: `tx ${state === "pending" ? "dropped" : "reverted"}; requeued` },
        });
      }
      changed++;
    }
  }
  return changed;
}

/** Mints already sent in the last 24h (rolling), for the daily cap. */
export async function mintedLast24h(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return prisma.attendanceNftClaim.count({
    where: { status: { in: ["SUBMITTED", "MINTED"] }, OR: [{ submittedAt: { gte: since } }, { mintedAt: { gte: since } }] },
  });
}

export async function processMintQueue(): Promise<QueueResult> {
  const ready = slicesReady();
  if (!ready.ok) return { status: "skipped", reason: ready.reason };

  const holder = randomUUID();
  if (!(await acquireLease(holder))) return { status: "skipped", reason: "busy" };
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

    const queued = await prisma.attendanceNftClaim.findMany({
      where: { status: "QUEUED", attempts: { lt: SLICES_MAX_ATTEMPTS } },
      orderBy: { claimedAt: "asc" },
      take: Math.min(SLICES_BATCH_SIZE, remaining),
      select: { id: true, recipient: true, callId: true },
    });
    // Out of attempts: surface on the admin page instead of retrying forever.
    await prisma.attendanceNftClaim.updateMany({ where: { status: "QUEUED", attempts: { gte: SLICES_MAX_ATTEMPTS } }, data: { status: "FAILED" } });
    if (queued.length === 0) return { status: "skipped", reason: "nothing_to_do", reconciled };

    const noWallet = queued.filter((q) => !q.recipient);
    if (noWallet.length) {
      await prisma.attendanceNftClaim.updateMany({ where: { id: { in: noWallet.map((q) => q.id) } }, data: { status: "AWAITING_WALLET" } });
    }
    const batch = queued.filter((q) => q.recipient);
    if (batch.length === 0) return { status: "skipped", reason: "nothing_to_do", reconciled };

    let maxFee: bigint;
    try {
      maxFee = await getMaxFeePerGas();
    } catch (e) {
      console.error("[slices] fee estimate failed:", scrubError(e));
      return { status: "skipped", reason: "rpc_error", reconciled };
    }
    if (Number(maxFee) / 1e9 > maxGasGwei()) return { status: "skipped", reason: "gas_too_high", reconciled };

    // ---- send ----
    const ids = batch.map((b) => b.id);
    await prisma.attendanceNftClaim.updateMany({ where: { id: { in: ids } }, data: { attempts: { increment: 1 } } });
    let hash: Hex;
    try {
      hash = await sendMintMany(
        batch.map((b) => ({ to: b.recipient as `0x${string}`, id: b.callId, key: claimKeyFor(b.id) })),
        maxFee,
      );
    } catch (e) {
      const msg = scrubError(e);
      console.error("[slices] send failed:", msg);
      await prisma.attendanceNftClaim.updateMany({ where: { id: { in: ids } }, data: { lastError: msg } });
      return { status: "ran", reconciled, submitted: 0, minted: 0 };
    }
    await prisma.attendanceNftClaim.updateMany({
      where: { id: { in: ids } },
      data: { status: "SUBMITTED", txHash: hash, chainId: sliceChain().id, submittedAt: new Date(), lastError: null },
    });

    const receipt = await waitForReceipt(hash);
    let minted = 0;
    if (receipt.state === "success") {
      const done = await prisma.attendanceNftClaim.updateMany({ where: { id: { in: ids }, status: "SUBMITTED" }, data: { status: "MINTED", mintedAt: new Date() } });
      minted = done.count;
    } // reverted / still pending: the next run's reconcile decides via claimUsed
    return { status: "ran", reconciled, submitted: batch.length, minted, txHash: hash };
  } finally {
    await releaseLease(holder);
  }
}

/** Fire-and-forget safe wrapper for after() hooks. */
export async function processMintQueueSafe(): Promise<void> {
  try {
    await processMintQueue();
  } catch (e) {
    console.error("[slices] queue run failed:", scrubError(e));
  }
}
