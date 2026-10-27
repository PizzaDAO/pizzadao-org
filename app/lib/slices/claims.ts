// Call Slices claims: members who attended a crew call (a CallAttendance row)
// claim one slice per call. Deliberately manual (no auto-mint) so members visit
// the app. A claim never needs a wallet: without one it waits as AWAITING_WALLET
// and is queued as soon as a wallet is linked.
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/db";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { getEvmWalletsReadOnly } from "@/app/lib/wallet-lookup";
import { isEvmAddress, txUrl } from "./config";

export type SliceStatus = "claimable" | "awaiting_wallet" | "queued" | "minting" | "minted" | "failed";

export type SliceItem = {
  crewId: string;
  crewLabel: string;
  /** UTC day, YYYY-MM-DD */
  callDay: string;
  status: SliceStatus;
  /** On-chain token id, once the call has been claimed by anyone */
  tokenId?: number;
  txHash?: string;
  txUrl?: string;
  imageUrl?: string;
};

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isValidDayKey(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** Activation code for the slice_claimed event (matches /^[a-z0-9_]{1,48}$/). */
export function claimActivationCode(crewId: string, callDay: string): string {
  return `${crewId.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${callDay.replace(/-/g, "")}`.slice(-48);
}

export function isUniqueViolation(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return true;
  const msg = e instanceof Error ? e.message : "";
  return /P2002|23505|unique constraint/i.test(msg);
}

const STATUS_MAP: Record<string, SliceStatus> = {
  AWAITING_WALLET: "awaiting_wallet",
  QUEUED: "queued",
  SUBMITTED: "minting",
  MINTED: "minted",
  FAILED: "failed",
};

/** Member id and first EVM wallet (primary first). Wallet is null when none is linked or lookup failed. */
export async function resolveRecipient(discordId: string): Promise<{ memberId: string | null; recipient: string | null }> {
  let memberId: string | null = null;
  try {
    memberId = await fetchMemberIdByDiscordId(discordId);
  } catch {
    return { memberId: null, recipient: null };
  }
  if (!memberId) return { memberId: null, recipient: null };
  try {
    const wallets = await getEvmWalletsReadOnly(memberId);
    const first = wallets.find(isEvmAddress);
    return { memberId, recipient: first ?? null };
  } catch {
    return { memberId, recipient: null };
  }
}

/** Attended calls (newest first, one per crew+day) with their claim status. */
export async function listSlices(discordId: string): Promise<SliceItem[]> {
  const attended = await prisma.callAttendance.findMany({
    where: { discordId },
    orderBy: { callDate: "desc" },
    take: 300,
    select: { crewId: true, crewLabel: true, callDate: true },
  });
  if (attended.length === 0) return [];

  const claims = await prisma.attendanceNftClaim.findMany({
    where: { discordId },
    select: { status: true, txHash: true, call: { select: { id: true, crewId: true, callDay: true, imageUrl: true } } },
  });
  const byKey = new Map(claims.map((c) => [`${c.call.crewId}|${dayKey(c.call.callDay)}`, c]));

  const out: SliceItem[] = [];
  const seen = new Set<string>();
  for (const a of attended) {
    const day = dayKey(a.callDate);
    const key = `${a.crewId}|${day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = byKey.get(key);
    out.push({
      crewId: a.crewId,
      crewLabel: a.crewLabel,
      callDay: day,
      status: c ? (STATUS_MAP[c.status] ?? "queued") : "claimable",
      ...(c ? { tokenId: c.call.id } : {}),
      ...(c?.txHash && c.status === "MINTED" ? { txHash: c.txHash, txUrl: txUrl(c.txHash) } : {}),
      ...(c?.call.imageUrl ? { imageUrl: c.call.imageUrl } : {}),
    });
  }
  return out;
}

export type ClaimOutcome =
  | { ok: true; claimed: number; already: number; hasWallet: boolean; newCallIds: number[]; claimedKeys: { crewId: string; callDay: string }[] }
  | { ok: false; reason: "invalid" | "not_attended" };

async function ensureCall(crewId: string, crewLabel: string, day: Date) {
  const where = { crewId_callDay: { crewId, callDay: day } };
  const found = await prisma.attendanceNftCall.findUnique({ where });
  if (found) return { call: found, created: false };
  try {
    return { call: await prisma.attendanceNftCall.create({ data: { crewId, crewLabel, callDay: day } }), created: true };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return { call: await prisma.attendanceNftCall.findUniqueOrThrow({ where }), created: false };
  }
}

/** Claim one or many attended calls. Idempotent per member per call. `targets` null = claim every claimable call. */
export async function claimSlices(discordId: string, targets: { crewId: string; callDay: string }[] | null): Promise<ClaimOutcome> {
  let wanted: { crewId: string; callDay: string }[];
  if (targets === null) {
    wanted = (await listSlices(discordId)).filter((i) => i.status === "claimable").map((i) => ({ crewId: i.crewId, callDay: i.callDay }));
  } else {
    if (targets.length === 0 || targets.length > 300) return { ok: false, reason: "invalid" };
    if (targets.some((t) => !isValidDayKey(t.callDay) || !t.crewId || t.crewId.length > 80)) return { ok: false, reason: "invalid" };
    wanted = targets;
  }

  const { memberId, recipient } = await resolveRecipient(discordId);
  let claimed = 0;
  let already = 0;
  const newCallIds: number[] = [];
  const claimedKeys: { crewId: string; callDay: string }[] = [];

  for (const t of wanted) {
    const day = new Date(`${t.callDay}T00:00:00Z`);
    const next = new Date(day.getTime() + 86400000);
    const attended = await prisma.callAttendance.findFirst({
      where: { discordId, crewId: t.crewId, callDate: { gte: day, lt: next } },
      select: { crewLabel: true },
    });
    if (!attended) {
      if (targets !== null) return { ok: false, reason: "not_attended" };
      continue;
    }
    const { call, created } = await ensureCall(t.crewId, attended.crewLabel, day);
    if (created || !call.imageUrl) newCallIds.push(call.id);
    try {
      await prisma.attendanceNftClaim.create({
        data: { discordId, memberId, callId: call.id, status: recipient ? "QUEUED" : "AWAITING_WALLET", recipient },
      });
      claimed++;
      claimedKeys.push(t);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      already++; // a parallel request (or an earlier click) already claimed it
    }
  }
  return { ok: true, claimed, already, hasWallet: !!recipient, newCallIds, claimedKeys };
}

/** Queue a member's AWAITING_WALLET claims once they have an EVM wallet. Returns how many were queued. */
export async function promoteAwaitingWallet(discordId: string): Promise<number> {
  const waiting = await prisma.attendanceNftClaim.count({ where: { discordId, status: "AWAITING_WALLET" } });
  if (waiting === 0) return 0;
  const { memberId, recipient } = await resolveRecipient(discordId);
  if (!recipient) return 0;
  const res = await prisma.attendanceNftClaim.updateMany({
    where: { discordId, status: "AWAITING_WALLET" },
    data: { status: "QUEUED", recipient, ...(memberId ? { memberId } : {}) },
  });
  return res.count;
}

/** Cron backstop: promote waiting members whose wallet (incl. sheet-only wallets) now exists. */
export async function sweepAwaitingWallet(limit = 25): Promise<number> {
  const rows = await prisma.attendanceNftClaim.findMany({
    where: { status: "AWAITING_WALLET" },
    distinct: ["discordId"],
    orderBy: { claimedAt: "asc" },
    take: limit,
    select: { discordId: true },
  });
  let promoted = 0;
  for (const r of rows) promoted += await promoteAwaitingWallet(r.discordId).catch(() => 0);
  return promoted;
}

/** Admin: put a FAILED claim back in the queue (resets attempts). */
export async function retryClaim(claimId: string): Promise<boolean> {
  const res = await prisma.attendanceNftClaim.updateMany({
    where: { id: claimId, status: "FAILED" },
    data: { status: "QUEUED", attempts: 0, lastError: null, txHash: null },
  });
  return res.count > 0;
}
