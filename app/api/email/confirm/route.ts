// app/api/email/confirm/route.ts
//
// POST /api/email/confirm?m=<memberId>&t=<token>
// The confirm button on /email/confirm (a browser form post). The token binds
// the member id, the exact address currently on file, and a 7-day expiry, so a
// stale link cannot verify a changed address. Sets emailVerifiedAt. POST only,
// so mail scanners that GET the link cannot verify anything.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { verifyConfirm } from "@/app/lib/reengage/unsub-sig";
import { internalError } from "@/app/lib/errors/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const memberId = url.searchParams.get("m") ?? "";
  const token = url.searchParams.get("t") ?? "";
  try {
    const row = memberId
      ? await prisma.memberProfileExtras.findUnique({ where: { memberId }, select: { email: true } })
      : null;
    if (!row?.email || !verifyConfirm(memberId, row.email, token)) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
    }
    // One verified owner per address: refuse a second claim with a generic error
    // (the DB also has a partial unique index on lower(email) for the race).
    const other = await prisma.memberProfileExtras.findFirst({
      where: { email: { equals: row.email, mode: "insensitive" }, emailVerifiedAt: { not: null }, NOT: { memberId } },
      select: { memberId: true },
    });
    if (other) return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
    await prisma.memberProfileExtras.update({
      where: { memberId },
      data: { emailVerifiedAt: new Date() },
      select: { memberId: true },
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
    }
    return internalError(err, "email/confirm", "Couldn't confirm");
  }
  const back = new URL("/email/confirm", req.url);
  back.searchParams.set("m", memberId);
  back.searchParams.set("t", token);
  back.searchParams.set("done", "1");
  return NextResponse.redirect(back, 303);
}
