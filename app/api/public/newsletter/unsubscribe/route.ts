// POST /api/public/newsletter/unsubscribe?s=<subscriberId>&sig=<sig>
// The target of the List-Unsubscribe header (RFC 8058 one-click: the mail client POSTs the body
// "List-Unsubscribe=One-Click" and expects a 2xx) and of the button on /newsletter/unsubscribe.
// The HMAC proves the link came from us for this subscriber. Idempotent. GET is deliberately not
// supported (link scanners prefetch GETs). Re-subscribing needs a new confirmation.
import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/app/lib/rate-limit";
import { verifyNewsletterUnsub } from "@/app/lib/newsletter/sig";
import { unsubscribeSubscriber } from "@/app/lib/newsletter/subscribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = await enforceRateLimit(req, "newsletter-unsubscribe");
  if (limited) return limited;
  const url = new URL(req.url);
  const id = url.searchParams.get("s");
  const sig = url.searchParams.get("sig");
  if (!verifyNewsletterUnsub(id, sig)) return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  const body = await req.text().catch(() => "");
  try {
    await unsubscribeSubscriber(id!);
  } catch (e) {
    console.error("[newsletter] unsubscribe failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Couldn't unsubscribe" }, { status: 500 });
  }
  // Mail-client one-click wins over the content type: always a plain 200.
  if (body.includes("List-Unsubscribe=One-Click")) return NextResponse.json({ ok: true }, { status: 200 });
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const back = new URL("/newsletter/unsubscribe", req.url);
    back.searchParams.set("s", id!);
    back.searchParams.set("sig", sig!);
    back.searchParams.set("done", "1");
    return NextResponse.redirect(back, 303);
  }
  return NextResponse.json({ ok: true });
}
