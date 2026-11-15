import { NextResponse } from "next/server";
import { COOKIE_NAME, verifySession } from "@/app/lib/session";
import { anyMagicLinkUsed } from "@/app/lib/magic-login";
import { MAGIC_PENDING_COOKIE, readPendingIds, readRequestCookie } from "@/app/lib/magic-login-pending";

export const runtime = "nodejs";

/**
 * Polled by the "check your DMs" tab (app/ui/onboarding/MagicLoginFlow.tsx).
 *   loggedIn:        this browser now has a session (the link was opened in another tab here).
 *   openedElsewhere: a link THIS browser asked for was used, but this browser is still logged out,
 *                    so it was opened in another browser (Discord's in-app browser, another device).
 * Only reports on links listed in this browser's own httpOnly pending cookie; never logs anyone in.
 */
export async function GET(req: Request) {
  const loggedIn = !!verifySession(readRequestCookie(req, COOKIE_NAME));
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
  return NextResponse.json({ loggedIn, openedElsewhere }, { headers: { "Cache-Control": "no-store" } });
}
