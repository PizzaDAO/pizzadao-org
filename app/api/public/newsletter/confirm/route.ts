// POST /api/public/newsletter/confirm?s=<subscriberId>&t=<token>
// The confirm button on /newsletter/confirm. No GET (link scanners prefetch GETs and must never
// subscribe anyone). The token binds the subscriber id, the exact address and a 7-day expiry.
// Idempotent. A browser form post is redirected back to the page with ?done=1.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { enforceRateLimit } from "@/app/lib/rate-limit";
import { confirmIssuedAt, verifyNewsletterConfirm } from "@/app/lib/newsletter/sig";
import { confirmSubscriber } from "@/app/lib/newsletter/subscribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = await enforceRateLimit(req, "newsletter-confirm");
  if (limited) return limited;
  const url = new URL(req.url);
  const id = url.searchParams.get("s");
  const token = url.searchParams.get("t");
  try {
    const row = id
      ? await prisma.newsletterSubscriber.findUnique({ where: { id }, select: { email: true } })
      : null;
    const verified = row ? verifyNewsletterConfirm(id, row.email, token) : null;
    const result = verified ? await confirmSubscriber(id!, confirmIssuedAt(verified.exp)) : "invalid";
    if (result === "invalid") return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  } catch (e) {
    console.error("[newsletter] confirm failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Couldn't confirm" }, { status: 500 });
  }
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const back = new URL("/newsletter/confirm", req.url);
    back.searchParams.set("s", id!);
    back.searchParams.set("t", token!);
    back.searchParams.set("done", "1");
    return NextResponse.redirect(back, 303);
  }
  return NextResponse.json({ ok: true });
}
