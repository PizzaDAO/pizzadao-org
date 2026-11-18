import { SIGNUP_DRAFT_COOKIE, SIGNUP_DRAFT_TTL_SECONDS } from "@/app/lib/signup-draft";
import { REF_COOKIE, refCookieOptions } from "@/app/lib/referral-cookie";
import { NextResponse } from "next/server";
import { verifyMagicToken } from "@/app/lib/magic-login";
import { createSessionToken, getSessionCookieOptions, setSessionCookies } from "@/app/lib/session";
import { syncRolesOnLogin } from "@/app/lib/sync-roles-on-login";
import { fetchMemberByDiscordId } from "@/app/lib/sheets/member-repository";
import { loginReturnPath } from "@/app/lib/login-return";
import {
  MAGIC_PENDING_COOKIE,
  OPENED_ELSEWHERE_PARAM,
  OPENED_ELSEWHERE_VALUE,
  readPendingIds,
  readRequestCookie,
} from "@/app/lib/magic-login-pending";

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
  const returnTo = loginReturnPath(url.searchParams.get("returnTo"));
  let redirectUrl: URL;
  if (memberId && (result.draft || url.searchParams.get("onboarding") !== "1")) {
    redirectUrl = new URL(returnTo || `/dashboard/${memberId}`, url.origin);
  } else {
    // New/unlinked user — redirect to onboarding with Discord info. The
    // wizard uses discordNick for the name-match auto-claim, and returnTo
    // to land on the page the member logged in from once linked.
    redirectUrl = new URL("/", url.origin);
    if (result.draft) redirectUrl.searchParams.set("resumeSignup", "1");
    redirectUrl.searchParams.set("discordId", result.discordId);
    redirectUrl.searchParams.set("discordJoined", "1");
    const nickForClaim = result.nick ?? result.username;
    if (nickForClaim) redirectUrl.searchParams.set("discordNick", nickForClaim);
    if (returnTo) redirectUrl.searchParams.set("returnTo", returnTo);
  }

  // Opened in a browser that did not ask for this link (Discord's in-app browser, another default
  // browser, another device): the login lands HERE, not in the tab that asked. Say so on arrival.
  const askedHere = !!result.tokenId && readPendingIds(readRequestCookie(req, MAGIC_PENDING_COOKIE)).includes(result.tokenId);
  if (result.tokenId && !askedHere) redirectUrl.searchParams.set(OPENED_ELSEWHERE_PARAM, OPENED_ELSEWHERE_VALUE);

  const res = NextResponse.redirect(redirectUrl.toString());
  // The link URL carries the one-time token: never cache this hop or leak it as a referrer.
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  const cookieOpts = getSessionCookieOptions(req);
  setSessionCookies(res, sessionToken, req);
  if (result.draft && result.tokenHash && !memberId) {
    res.cookies.set(SIGNUP_DRAFT_COOKIE, result.tokenHash, { ...cookieOpts, maxAge: SIGNUP_DRAFT_TTL_SECONDS });
    if (result.draft.invitedBy?.viaLink) res.cookies.set(REF_COOKIE, result.draft.invitedBy.memberId, refCookieOptions(req));
  }
  return res;
}
