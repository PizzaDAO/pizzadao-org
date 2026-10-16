import { SIGNUP_DRAFT_COOKIE, SIGNUP_DRAFT_TTL_SECONDS } from "@/app/lib/signup-draft";
import { REF_COOKIE, refCookieOptions } from "@/app/lib/referral-cookie";
import { NextResponse } from "next/server";
import { verifyMagicToken } from "@/app/lib/magic-login";
import { createSessionToken, getSessionCookieOptions, COOKIE_NAME } from "@/app/lib/session";
import { syncRolesOnLogin } from "@/app/lib/sync-roles-on-login";
import { fetchMemberByDiscordId } from "@/app/lib/sheets/member-repository";
import { loginReturnPath } from "@/app/lib/login-return";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawToken = url.searchParams.get("token");

  if (!rawToken) {
    return NextResponse.redirect(
      new URL("/login?loginError=missing_token", url.origin).toString(),
    );
  }

  const result = await verifyMagicToken(rawToken);

  if (!result.valid) {
    const errorMap = {
      invalid: "invalid_token",
      expired: "link_expired",
      used: "link_already_used",
    };
    return NextResponse.redirect(
      new URL(`/login?loginError=${errorMap[result.reason]}`, url.origin).toString(),
    );
  }

  // Create session — identical to OAuth flow
  const sessionToken = createSessionToken({
    discordId: result.discordId,
    username: result.username,
    nick: result.nick ?? undefined,
    createdAt: Date.now(),
  });

  // Look up the member row already linked to this Discord ID (direct lib call).
  // Unlinked users are sent to onboarding, where the wizard's name-match
  // auto-claim (/api/auto-claim, session-authenticated) links the row.
  // Role sync never links rows itself.
  let memberId: string | undefined;
  let memberName: string | undefined;

  try {
    const found = await fetchMemberByDiscordId(result.discordId);
    if (found?.memberId) {
      memberId = String(found.memberId);
      memberName = found.name || undefined;
    }
  } catch {
    // Lookup failure is non-fatal — we'll still create the session
    // and send the user to onboarding.
  }

  // Always sync Discord roles to the (already linked) sheet row — mirrors OAuth callback.
  syncRolesOnLogin(result.discordId, memberName ?? result.nick ?? result.username).catch(() => {});

  // Build redirect URL
  let redirectUrl: URL;
  if (memberId && (result.draft || url.searchParams.get("onboarding") !== "1")) {
    redirectUrl = new URL(loginReturnPath(url.searchParams.get("returnTo")) || `/dashboard/${memberId}`, url.origin);
  } else {
    // New/unlinked user — redirect to onboarding with Discord info. The
    // wizard uses discordNick for the name-match auto-claim.
    redirectUrl = new URL("/", url.origin);
    if (result.draft) redirectUrl.searchParams.set("resumeSignup", "1");
    redirectUrl.searchParams.set("discordId", result.discordId);
    redirectUrl.searchParams.set("discordJoined", "1");
    const nickForClaim = result.nick ?? result.username;
    if (nickForClaim) redirectUrl.searchParams.set("discordNick", nickForClaim);
  }

  const res = NextResponse.redirect(redirectUrl.toString());
  const cookieOpts = getSessionCookieOptions(req);
  res.cookies.set(COOKIE_NAME, sessionToken, cookieOpts);
  if (result.draft && result.tokenHash && !memberId) {
    res.cookies.set(SIGNUP_DRAFT_COOKIE, result.tokenHash, { ...cookieOpts, maxAge: SIGNUP_DRAFT_TTL_SECONDS });
    if (result.draft.invitedBy?.viaLink) res.cookies.set(REF_COOKIE, result.draft.invitedBy.memberId, refCookieOptions(req));
  }
  return res;
}
