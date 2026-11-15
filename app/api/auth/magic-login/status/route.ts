import { NextResponse } from "next/server";
import { COOKIE_NAME, verifySession } from "@/app/lib/session";
import { anyMagicLinkUsed } from "@/app/lib/magic-login";
import { enforceRateLimit } from "@/app/lib/rate-limit";
import { MAGIC_PENDING_COOKIE, readPendingIds, readRequestCookie } from "@/app/lib/magic-login-pending";

export const runtime = "nodejs";

/**
 * Polled by the "check your DMs" tab (app/ui/onboarding/MagicLoginFlow.tsx).
 *   loggedIn:        this browser now has a session (the link was opened in another tab here).
 *   openedElsewhere: a link THIS browser asked for was used, but this browser is still logged out,
 *                    so it was opened in another browser (Discord's in-app browser, another device).
 * Reports only on links listed in this browser's own signed, httpOnly pending cookie, and never logs
 * anyone in. It does tell the requester that their link was clicked: someone who requests a link
 * for another member's name learns when that member clicks it (nothing more). The per-member
 * request limit (3 links per 15 min) bounds how often that can be probed.
 */
export async function GET(req: Request) {
  const limited = await enforceRateLimit(req, "magic-login-status");
  if (limited) return limited;

  const session = verifySession(readRequestCookie(req, COOKIE_NAME));
  const loggedIn = !!session;
  let openedElsewhere = false;
  if (!loggedIn) {
    const ids = readPendingIds(readRequestCookie(req, MAGIC_PENDING_COOKIE));
    try {
      // Only the newest link: after "opened elsewhere" the member may ask for a fresh one to open here.
      openedElsewhere = await anyMagicLinkUsed(ids.slice(-1));
    } catch {
      openedElsewhere = false;
    }
  }
  // sessionCreatedAt lets a tab that was already logged in (?switch=1) tell the new login from the old.
  const body = session ? { loggedIn, openedElsewhere, sessionCreatedAt: Number(session.createdAt) } : { loggedIn, openedElsewhere };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
