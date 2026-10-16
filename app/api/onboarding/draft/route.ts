import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/auth-guards";
import { prisma } from "@/app/lib/db";
import { SIGNUP_DRAFT_COOKIE, SIGNUP_DRAFT_TTL_SECONDS, sanitizeSignupDraft } from "@/app/lib/signup-draft";

export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const tokenHash = (await cookies()).get(SIGNUP_DRAFT_COOKIE)?.value;
  if (!tokenHash || !/^[a-f0-9]{64}$/.test(tokenHash)) return NextResponse.json({ draft: null }, { headers: { "Cache-Control": "no-store" } });
  try {
    const token = await prisma.magicLoginToken.findFirst({ where: { tokenHash, discordId: auth.session.discordId, usedAt: { gte: new Date(Date.now() - SIGNUP_DRAFT_TTL_SECONDS * 1000) } } });
    return NextResponse.json({ draft: sanitizeSignupDraft(token?.signupDraft) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Could not restore signup. Please retry." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
