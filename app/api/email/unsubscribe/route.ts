// app/api/email/unsubscribe/route.ts
//
// POST /api/email/unsubscribe?m=<memberId>&s=<sig>
// The target of the List-Unsubscribe header (RFC 8058 one-click: the mail
// client POSTs the body "List-Unsubscribe=One-Click" and expects a 2xx) and of
// the confirm button on /email/unsubscribe (a browser form post, which is
// redirected back to the confirmation page). No login: the HMAC in `s`
// proves the link came from us for this member. Flips the opt-in OFF for this member and every row holding the same address (case-insensitive).
// Idempotent. GET is deliberately not supported (link scanners prefetch GETs).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { verifyUnsubscribe } from "@/app/lib/reengage/unsub-sig";
import { internalError } from "@/app/lib/errors/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const memberId = url.searchParams.get("m");
  const sig = url.searchParams.get("s");
  if (!verifyUnsubscribe(memberId, sig)) {
    return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  }
  const body = await req.text().catch(() => "");
  try {
    const mine = await prisma.memberProfileExtras.upsert({
      where: { memberId: memberId! },
      create: { memberId: memberId!, reengageEmailOptIn: false },
      update: { reengageEmailOptIn: false },
      select: { email: true },
    });
    // Unsubscribing an address unsubscribes it everywhere, not just on this member.
    if (mine?.email) {
      await prisma.memberProfileExtras.updateMany({
        where: { email: { equals: mine.email, mode: "insensitive" } },
        data: { reengageEmailOptIn: false },
      });
    }
  } catch (err) {
    return internalError(err, "email/unsubscribe", "Couldn't unsubscribe");
  }
  // Mail-client one-click wins over the content type: always a plain 200.
  if (body.includes("List-Unsubscribe=One-Click")) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const back = new URL("/email/unsubscribe", req.url);
    back.searchParams.set("m", memberId!);
    back.searchParams.set("s", sig!);
    back.searchParams.set("done", "1");
    return NextResponse.redirect(back, 303);
  }
  return NextResponse.json({ ok: true });
}
