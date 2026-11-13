import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { enforceRateLimit } from "@/app/lib/rate-limit";
import { loadSettings } from "@/app/lib/settings";
import { resolveToggle } from "@/app/lib/settings/toggles";
import { contactEmail, isHoneypotFilled, parseContact } from "@/app/lib/marketing/forms";
import { oneLine, sendEmail } from "@/app/lib/reengage/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/public/contact { name, organization?, email, message, intents? } -> { ok: true, emailed }
 * The website's contact and partnership forms. The message is stored first; the team notification
 * is best effort (marketing.contactNotifyEmail, through Resend) and its outcome is only recorded.
 * 503 while marketing.contactEnabled is off.
 */
export async function POST(req: Request) {
  try {
    const settings = await loadSettings();
    if (!resolveToggle("marketing.contactEnabled", settings)) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    const limited = await enforceRateLimit(req, "marketing-contact");
    if (limited) return limited;

    const body = await req.json().catch(() => null);
    if (isHoneypotFilled(body)) return NextResponse.json({ ok: true, emailed: false });
    const parsed = parseContact(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const c = parsed.value;

    const row = await prisma.contactSubmission.create({ data: c, select: { id: true } });

    let emailed = false;
    const to = settings.get("marketing.contactNotifyEmail");
    if (to) {
      try {
        const mail = contactEmail(row.id, c);
        const sent = await sendEmail({
          to,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          headers: { "Reply-To": oneLine(c.email) },
          idempotencyKey: `contact-${row.id}`,
        });
        emailed = sent.ok;
        if (emailed) await prisma.contactSubmission.update({ where: { id: row.id }, data: { emailed: true } });
      } catch (e) {
        console.error("[contact] notification failed (message stored)", e instanceof Error ? e.message : e);
      }
    }
    return NextResponse.json({ ok: true, emailed });
  } catch (e) {
    console.error("[contact] failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not save message" }, { status: 500 });
  }
}
