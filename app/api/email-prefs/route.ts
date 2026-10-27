// app/api/email-prefs/route.ts
//
// The signed-in member's weekly-digest settings (profile edit page).
//   GET  -> { email, verified, optIn }   (the real stored state)
//   POST (application/json only) { email?, optIn?, resend? } -> same, plus
//        `confirmation`: "sent" | "too_soon" | "too_many" | "failed" | null
// An empty / null email removes the address (and opts out). The address lives
// in MemberProfileExtras (never the public Crew sheet). A new or changed
// address is unverified until the member clicks the signed link in the
// confirmation email. That email is the only mail sent without an opt-in, and
// only when the member asks for it here, so it is rate limited hard (anti
// mail-bomb), independent of whether the address changed:
//   - 1 per 5 min per member, claimed ATOMICALLY (updateMany on emailConfirmSentAt)
//   - 5 per 24 h per member, 3 per 24 h per target address, 10 per 24 h per IP,
//     counted in EmailConfirmSend (address and IP hashed). The log row is
//     inserted first and removed if it pushed a counter over its cap.
import { createHash } from "crypto";
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
import { getClientIp, rateLimitIp } from "@/app/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIRM_THROTTLE_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CAP_PER_MEMBER = 5;
const CAP_PER_ADDRESS = 3;
const CAP_PER_IP = 10;

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

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex");
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

type Confirmation = "sent" | "too_soon" | "too_many" | "failed";

/** Atomically claim the 5-minute slot, check the daily caps, then send. */
async function sendConfirmation(
  memberId: string,
  email: string,
  locale: string | null,
  ip: string,
): Promise<Confirmation> {
  const now = Date.now();
  const claimed = await prisma.memberProfileExtras.updateMany({
    where: {
      memberId,
      OR: [{ emailConfirmSentAt: null }, { emailConfirmSentAt: { lt: new Date(now - CONFIRM_THROTTLE_MS) } }],
    },
    data: { emailConfirmSentAt: new Date(now) },
  });
  if (claimed.count !== 1) return "too_soon";

  const emailHash = sha(email.trim().toLowerCase());
  const ipHash = sha(`ip:${rateLimitIp(ip)}`);
  const entry = await prisma.emailConfirmSend.create({
    data: { memberId, emailHash, ipHash },
    select: { id: true },
  });
  const since = new Date(now - DAY_MS);
  const [byMember, byAddress, byIp] = await Promise.all([
    prisma.emailConfirmSend.count({ where: { memberId, createdAt: { gte: since } } }),
    prisma.emailConfirmSend.count({ where: { emailHash, createdAt: { gte: since } } }),
    prisma.emailConfirmSend.count({ where: { ipHash, createdAt: { gte: since } } }),
  ]);
  if (byMember > CAP_PER_MEMBER || byAddress > CAP_PER_ADDRESS || byIp > CAP_PER_IP) {
    await prisma.emailConfirmSend.delete({ where: { id: entry.id } });
    return "too_many";
  }

  const token = signConfirm(memberId, email);
  if (!token) return "failed";
  const loc = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
  const mail = renderConfirmEmail(loc, confirmPageUrl(memberId, token), { postalAddress: postalAddress() });
  const res = await sendEmail({ to: email, ...mail });
  return res.ok ? "sent" : "failed";
}

export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  // A cross-site form cannot send application/json without a CORS preflight.
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  let body: { email?: unknown; optIn?: unknown; resend?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // fall through to validation
  }
  const hasEmail = body.email !== undefined;
  const remove = hasEmail && (body.email === null || (typeof body.email === "string" && body.email.trim() === ""));
  if (hasEmail && !remove && (typeof body.email !== "string" || body.email.length > 254 || !EMAIL_RE.test(body.email.trim()))) {
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

    const data: { email?: string | null; emailVerifiedAt?: null; reengageEmailOptIn?: boolean } = {};
    if (remove) {
      // Clearing the field removes the address and opts out.
      data.email = null;
      data.emailVerifiedAt = null;
      data.reengageEmailOptIn = false;
    } else if (hasEmail) {
      const next = (body.email as string).trim();
      if (next.toLowerCase() !== (current?.email ?? "").toLowerCase()) {
        data.email = next;
        data.emailVerifiedAt = null; // a changed address must be re-verified
      }
    }
    if (typeof body.optIn === "boolean" && !remove) data.reengageEmailOptIn = body.optIn;

    const saved = await prisma.memberProfileExtras.upsert({
      where: { memberId },
      create: { memberId, ...data },
      update: data,
      select: SELECT,
    });

    // Ask for confirmation only when the member wants the digest and the address is unverified.
    let confirmation: Confirmation | null = null;
    const wantsConfirm = body.resend === true || data.email !== undefined || body.optIn === true;
    if (wantsConfirm && saved.email && !saved.emailVerifiedAt && saved.reengageEmailOptIn) {
      confirmation = await sendConfirmation(memberId, saved.email, saved.locale, getClientIp(req.headers));
    }
    return NextResponse.json({ ...state(saved), confirmation });
  } catch (err) {
    return internalError(err, "email-prefs POST", "Couldn't save email preference");
  }
}
