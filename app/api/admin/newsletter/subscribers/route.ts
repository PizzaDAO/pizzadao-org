// GET /api/admin/newsletter/subscribers (admin only): subscriber counts by consent state and the
// state of the switches that decide whether any newsletter email can go out. Counts only.
import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { requireAdmin } from "@/app/lib/auth-guards";
import { loadSettings } from "@/app/lib/settings";
import { resolveToggle } from "@/app/lib/settings/toggles";
import { newsletterSender } from "@/app/lib/newsletter/sender";
import { internalError } from "@/app/lib/errors/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  try {
    const settings = await loadSettings();
    const [confirmed, pending, legacy, unsubscribed] = await Promise.all([
      prisma.newsletterSubscriber.count({ where: { status: "subscribed", confirmedAt: { not: null } } }),
      prisma.newsletterSubscriber.count({ where: { status: "pending" } }),
      prisma.newsletterSubscriber.count({ where: { status: "subscribed", confirmedAt: null } }),
      prisma.newsletterSubscriber.count({ where: { status: "unsubscribed" } }),
    ]);
    return NextResponse.json(
      {
        counts: { confirmed, pending, legacyUnconfirmed: legacy, unsubscribed },
        senderConfigured: newsletterSender(settings) !== null,
        resendConfigured: !!process.env.RESEND_API_KEY?.trim(),
        production: process.env.VERCEL_ENV === "production",
        confirmEmailsEnabled: resolveToggle("newsletter.confirmEmailsEnabled", settings),
        memberOptInEnabled: resolveToggle("newsletter.memberOptInEnabled", settings),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    return internalError(err, "admin/newsletter/subscribers", "Couldn't load newsletter subscribers");
  }
}
