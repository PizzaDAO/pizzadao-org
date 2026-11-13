import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { enforceRateLimit } from "@/app/lib/rate-limit";
import { loadSettings } from "@/app/lib/settings";
import { resolveToggle } from "@/app/lib/settings/toggles";
import { parseNewsletter } from "@/app/lib/marketing/forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/public/newsletter { email, source? } -> { ok: true, already?: true }
 * The website's newsletter signup (footer and journal). 503 while marketing.newsletterEnabled is off.
 * A repeat address answers ok with already: true.
 */
export async function POST(req: Request) {
  try {
    if (!resolveToggle("marketing.newsletterEnabled", await loadSettings())) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    const limited = await enforceRateLimit(req, "marketing-newsletter");
    if (limited) return limited;

    const body = await req.json().catch(() => null);
    const parsed = parseNewsletter(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    try {
      await prisma.newsletterSubscriber.create({ data: parsed.value });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") {
        return NextResponse.json({ ok: true, already: true });
      }
      throw e;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[newsletter] failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not subscribe" }, { status: 500 });
  }
}
