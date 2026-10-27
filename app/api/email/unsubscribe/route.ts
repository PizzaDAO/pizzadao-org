// app/api/email/unsubscribe/route.ts
//
// POST /api/email/unsubscribe?m=<memberId>&s=<sig>
// The target of the List-Unsubscribe header (RFC 8058 one-click: mail clients
// POST "List-Unsubscribe=One-Click" here) and of the confirm button on
// /email/unsubscribe. No login: the HMAC in `s` (SESSION_SECRET) proves the link
// came from us for this member. A browser form post (urlencoded/multipart) is
// redirected back to the confirmation page; anything else gets JSON.
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
  try {
    await prisma.memberProfileExtras.upsert({
      where: { memberId: memberId! },
      create: { memberId: memberId!, reengageEmailOptOut: true },
      update: { reengageEmailOptOut: true },
    });
  } catch (err) {
    return internalError(err, "email/unsubscribe", "Couldn't unsubscribe");
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
