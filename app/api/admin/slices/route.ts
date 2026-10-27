// Admin-only Call Slices console.
// GET  -> status: kill switch, minter address + balance, daily count, queue counts, failed/stuck claims, recent calls, crews + template art
// POST { action: "retry", claimId } | { action: "rerender", callId } | { action: "run" }
import { NextResponse } from "next/server";
import { requireAdmin } from "@/app/lib/auth-guards";
import { prisma } from "@/app/lib/db";
import { getCrewMappings } from "@/app/lib/crew-mappings";
import { chainWhere, dailyCap, minBalanceWei, slicesEnabled, slicesReady, addressUrl, contractAddress } from "@/app/lib/slices/config";
import { dayKey, retryClaim } from "@/app/lib/slices/claims";
import { mintedLast24h, processMintQueue } from "@/app/lib/slices/mint-queue";
import { getMinterBalance, minterAddress, scrubError } from "@/app/lib/slices/minter";
import { ensureCallImage } from "@/app/lib/slices/art";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const ready = slicesReady();
  let minter: { address: string; balanceEth: string; low: boolean } | null = null;
  if (ready.ok) {
    try {
      const balance = await getMinterBalance();
      minter = { address: minterAddress(), balanceEth: (Number(balance) / 1e18).toFixed(5), low: balance < minBalanceWei() };
    } catch (e) {
      console.error("[admin/slices] balance error:", scrubError(e));
    }
  }

  const [grouped, failed, stuck, calls, arts, failing] = await Promise.all([
    prisma.attendanceNftClaim.groupBy({ by: ["status"], where: chainWhere(), _count: { _all: true } }),
    prisma.attendanceNftClaim.findMany({
      where: { status: { in: ["FAILED", "SKIPPED_ALREADY_HELD"] }, ...chainWhere() },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, discordId: true, callId: true, attempts: true, lastError: true },
    }),
    prisma.attendanceNftClaim.findMany({
      where: { status: "SUBMITTED", ...chainWhere(), submittedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
      take: 50,
      select: { id: true, callId: true, txHash: true, submittedAt: true },
    }),
    prisma.attendanceNftCall.findMany({
      orderBy: { id: "desc" },
      take: 40,
      select: { id: true, crewId: true, crewLabel: true, callDay: true, imageUrl: true, _count: { select: { claims: true } } },
    }),
    prisma.sliceCrewArt.findMany(),
    // Still queued but the last send attempt errored: shows why a row is not moving.
    prisma.attendanceNftClaim.findMany({
      where: { status: "QUEUED", ...chainWhere(), lastError: { not: null } },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, discordId: true, callId: true, attempts: true, lastError: true },
    }),
  ]);

  let crews: { id: string; label: string }[] = [{ id: "community_call", label: "Community Call" }];
  try {
    const { crews: list } = await getCrewMappings();
    crews = [...crews, ...list.filter((c) => c.id !== "community_call").map((c) => ({ id: c.id, label: c.label }))];
  } catch {
    // crew sheet unavailable: fall back to crews that already have art or calls
    const ids = new Set([...arts.map((a) => a.crewId), ...calls.map((c) => c.crewId)]);
    crews = [...ids].map((id) => ({ id, label: id }));
  }
  const artBy = new Map(arts.map((a) => [a.crewId, a.imageUrl]));

  const contract = contractAddress();
  return NextResponse.json({
    enabled: slicesEnabled(),
    ready: ready.ok ? "ok" : ready.reason,
    contract: contract ? { address: contract, url: addressUrl(contract) } : null,
    minter,
    daily: { used: await mintedLast24h().catch(() => 0), cap: dailyCap() },
    counts: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
    failed,
    failing,
    stuck,
    calls: calls.map((c) => ({ id: c.id, crewId: c.crewId, crewLabel: c.crewLabel, callDay: dayKey(c.callDay), imageUrl: c.imageUrl, claims: c._count.claims })),
    crews: crews.map((c) => ({ ...c, artUrl: artBy.get(c.id) ?? null })),
  });
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const body = (await req.json().catch(() => null)) as { action?: unknown; claimId?: unknown; callId?: unknown } | null;
  try {
    if (body?.action === "retry" && typeof body.claimId === "string") {
      return NextResponse.json({ ok: await retryClaim(body.claimId) });
    }
    if (body?.action === "rerender" && typeof body.callId === "number" && Number.isInteger(body.callId)) {
      const url = await ensureCallImage(body.callId, true);
      return NextResponse.json({ ok: !!url, imageUrl: url });
    }
    if (body?.action === "run") {
      return NextResponse.json({ ok: true, result: await processMintQueue() });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[admin/slices] POST error:", scrubError(err));
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
