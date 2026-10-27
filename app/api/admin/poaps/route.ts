// Admin-only POAP mint-link pools.
// GET  -> { pools: [{ crewId, callDay, total, claimed }] }
// POST { crewId, callDay: "YYYY-MM-DD", links: string } -> { added, duplicates, invalid }
import { NextResponse } from "next/server";
import { requireAdmin } from "@/app/lib/auth-guards";
import { prisma } from "@/app/lib/db";
import { dayKey, isValidDayKey, parseMintLinks } from "@/app/lib/poap-claims";

export const runtime = "nodejs";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const rows = await prisma.poapMintLink.groupBy({
    by: ["crewId", "callDay"],
    _count: { _all: true, claimedBy: true },
    orderBy: { callDay: "desc" },
    take: 200,
  });
  return NextResponse.json({
    pools: rows.map((r) => ({ crewId: r.crewId, callDay: dayKey(r.callDay), total: r._count._all, claimed: r._count.claimedBy })),
  });
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const body = (await req.json().catch(() => null)) as { crewId?: unknown; callDay?: unknown; links?: unknown } | null;
  const crewId = typeof body?.crewId === "string" ? body.crewId.trim() : "";
  if (!crewId || crewId.length > 80 || !isValidDayKey(body?.callDay) || typeof body?.links !== "string" || body.links.length > 200_000) {
    return NextResponse.json({ error: "crewId, callDay (YYYY-MM-DD) and links are required" }, { status: 400 });
  }
  const { valid, invalid } = parseMintLinks(body.links);
  if (valid.length === 0) return NextResponse.json({ error: "No valid POAP mint links", invalid }, { status: 400 });
  const res = await prisma.poapMintLink.createMany({
    data: valid.map((link) => ({ crewId, callDay: new Date(`${body.callDay}T00:00:00Z`), link })),
    skipDuplicates: true,
  });
  const day = new Date(`${body.callDay}T00:00:00Z`);
  const attendees = await prisma.callAttendance.count({
    where: { crewId, callDate: { gte: day, lt: new Date(day.getTime() + 86400000) } },
  });
  const warning = attendees === 0 ? "No attendance recorded for this crewId and day yet; check the crew id and date." : undefined;
  return NextResponse.json({ added: res.count, duplicates: valid.length - res.count, invalid, ...(warning ? { warning } : {}) });
}
