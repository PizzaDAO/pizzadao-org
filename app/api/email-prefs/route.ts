// app/api/email-prefs/route.ts
//
// The signed-in member's weekly-digest settings (profile edit page).
//   GET  -> { email, verified, optIn }   (the real stored state)
//   POST { email?, optIn?, resend? } -> same, plus `confirmation`:
//        "sent" | "too_soon" | "failed" | null
// The address lives in MemberProfileExtras (never the public Crew sheet). A new
// or changed address is unverified until the member clicks the signed link in
// the confirmation email. That email is the only mail sent without an opt-in,
// and only when the member asks for it here (opts in with the address, or
// presses "resend"); it is throttled to one per 5 minutes. The digest itself
// goes only to a verified AND opted-in address.
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/app/lib/auth-guards";
import { prisma } from "@/app/lib/db";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { internalError } from "@/app/lib/errors/error-response";
import { EMAIL_RE } from "@/app/lib/reengage/run";
import { sendEmail, postalAddress } from "@/app/lib/reengage/mailer";
import { renderConfirmEmail } from "@/app/lib/reengage/render";
import { confirmPageUrl, signConfirm } from "@/app/lib/reengage/unsub-sig";
import { isSupportedLocale, DEFAULT_LOCALE } from "@/app/lib/i18n/locales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIRM_THROTTLE_MS = 5 * 60 * 1000;

async function memberFor(discordId: string): Promise<string | null> {
  return fetchMemberIdByDiscordId(discordId).catch(() => null);
}

const SELECT = {
  email: true,
  emailVerifiedAt: true,
  emailConfirmSentAt: true,
  reengageEmailOptIn: true,
  locale: true,
} as const;

function state(row: { email: string | null; emailVerifiedAt: Date | null; reengageEmailOptIn: boolean } | null) {
  return { email: row?.email ?? null, verified: !!row?.emailVerifiedAt, optIn: !!row?.reengageEmailOptIn };
}

export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  try {
    const memberId = await memberFor(auth.session.discordId);
    if (!memberId) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    const row = await prisma.memberProfileExtras.findUnique({ where: { memberId }, select: SELECT });
    return NextResponse.json(state(row));
  } catch (err) {
    return internalError(err, "email-prefs GET", "Couldn't load email preference");
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  let body: { email?: unknown; optIn?: unknown; resend?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // fall through to validation
  }
  const hasEmail = body.email !== undefined;
  if (hasEmail && (typeof body.email !== "string" || body.email.length > 254 || !EMAIL_RE.test(body.email.trim()))) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (body.optIn !== undefined && typeof body.optIn !== "boolean") {
    return NextResponse.json({ error: "optIn must be a boolean" }, { status: 400 });
  }
  if (!hasEmail && body.optIn === undefined && body.resend !== true) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  try {
    const memberId = await memberFor(auth.session.discordId);
    if (!memberId) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    const current = await prisma.memberProfileExtras.findUnique({ where: { memberId }, select: SELECT });

    const data: { email?: string; emailVerifiedAt?: null; reengageEmailOptIn?: boolean } = {};
    if (hasEmail) {
      const next = (body.email as string).trim();
      if (next.toLowerCase() !== (current?.email ?? "").toLowerCase()) {
        data.email = next;
        data.emailVerifiedAt = null; // a changed address must be re-verified
      }
    }
    if (typeof body.optIn === "boolean") data.reengageEmailOptIn = body.optIn;

    const saved = await prisma.memberProfileExtras.upsert({
      where: { memberId },
      create: { memberId, ...data },
      update: data,
      select: SELECT,
    });

    // Ask for confirmation only when the member wants the digest and the address is unverified.
    let confirmation: "sent" | "too_soon" | "failed" | null = null;
    const wantsConfirm = body.resend === true || data.email !== undefined || body.optIn === true;
    if (wantsConfirm && saved.email && !saved.emailVerifiedAt && saved.reengageEmailOptIn) {
      const last = saved.emailConfirmSentAt?.getTime() ?? 0;
      const fresh = data.email !== undefined; // a brand-new address is never throttled by the old one's send
      if (!fresh && Date.now() - last < CONFIRM_THROTTLE_MS) {
        confirmation = "too_soon";
      } else {
        const token = signConfirm(memberId, saved.email);
        if (!token) {
          confirmation = "failed";
        } else {
          const locale = isSupportedLocale(saved.locale) ? saved.locale : DEFAULT_LOCALE;
          const mail = renderConfirmEmail(locale, confirmPageUrl(memberId, token), { postalAddress: postalAddress() });
          const res = await sendEmail({ to: saved.email, ...mail });
          confirmation = res.ok ? "sent" : "failed";
          if (res.ok) {
            await prisma.memberProfileExtras.update({ where: { memberId }, data: { emailConfirmSentAt: new Date() } });
          }
        }
      }
    }
    return NextResponse.json({ ...state(saved), confirmation });
  } catch (err) {
    return internalError(err, "email-prefs POST", "Couldn't save email preference");
  }
}
