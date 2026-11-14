import { NextResponse, after } from "next/server";
import { enforceRateLimit } from "@/app/lib/rate-limit";
import { loadSettings } from "@/app/lib/settings";
import { resolveToggle } from "@/app/lib/settings/toggles";
import { isHoneypotFilled, parseNewsletter } from "@/app/lib/marketing/forms";
import { requestSubscription } from "@/app/lib/newsletter/subscribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/public/newsletter { email, source? } -> { ok: true }
 * The website's newsletter signup (footer and journal), double opt-in: the address is stored as
 * pending and a confirmation email is sent when newsletter.confirmEmailsEnabled is on and a sender
 * is configured. The answer is the same for a new, repeat, pending, confirmed or unsubscribed
 * address, so the endpoint does not reveal who is subscribed. 503 while marketing.newsletterEnabled is off.
 */
export async function POST(req: Request) {
  try {
    if (!resolveToggle("marketing.newsletterEnabled", await loadSettings())) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    const limited = await enforceRateLimit(req, "marketing-newsletter");
    if (limited) return limited;

    const body = await req.json().catch(() => null);
    if (isHoneypotFilled(body)) return NextResponse.json({ ok: true });
    const parsed = parseNewsletter(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    // Run after the response where Next allows it, so the response time does not depend on whether
    // an email was sent (outside a request, e.g. in tests, it just runs inline).
    const work = () =>
      requestSubscription(parsed.value).then(
        () => undefined,
        (e) => console.error("[newsletter] signup failed", e instanceof Error ? e.message : e),
      );
    try {
      after(work);
    } catch {
      await work();
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[newsletter] failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not subscribe" }, { status: 500 });
  }
}
