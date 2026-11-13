import { NextResponse } from "next/server";
import { createSessionToken, getSessionCookieOptions, COOKIE_NAME } from "@/app/lib/session";
import { readCookie, verifyTransferToken } from "@/app/lib/oauth-proxy";
import { loginReturnPath } from "@/app/lib/login-return";
import { toggleEnabled } from "@/app/lib/settings/toggles";
import { prisma } from "@/app/lib/db";
import {
  BRIDGE_CONSUMED_KIND,
  BRIDGE_COOKIE,
  BRIDGE_RESPONSE_HEADERS,
  bridgeCookieMatches,
  bridgeCookieOptions,
  bridgeTokenHash,
} from "@/app/lib/session-bridge";

export const runtime = "nodejs";

/**
 * Accepts a signed transfer token and starts a session on this origin: the Discord OAuth preview
 * proxy (token from the callback) and the session bridge (token from the old app host, see
 * app/lib/session-bridge.ts). `next` is an optional local page path to land on (default "/").
 *
 * Bridge tokens (those with a jti) additionally need the matching httpOnly cookie, the
 * site.sessionBridgeEnabled switch, and are spent once. The token is never logged.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const next = loginReturnPath(url.searchParams.get("next"));

  // Where a failed bridge lands: the page they asked for, signed out (they sign in again).
  const fail = (body: { error: string }, status: number) =>
    next ? bridgeResponse(NextResponse.redirect(new URL(next, url.origin).toString()), url.origin, false) : NextResponse.json(body, { status });

  if (!token) {
    return NextResponse.json({ error: "Missing transfer token" }, { status: 400 });
  }

  const transfer = verifyTransferToken(token);
  if (!transfer) {
    return fail({ error: "Invalid or expired transfer token" }, 401);
  }

  // Verify origin matches
  if (transfer.origin !== url.origin) {
    return fail({ error: "Token not valid for this origin" }, 403);
  }

  if (transfer.jti) {
    // A bridge token: kill switch, bound to the browser that asked, and one use only.
    if (!(await toggleEnabled("site.sessionBridgeEnabled"))) {
      return fail({ error: "Session bridge is off" }, 403);
    }
    if (!bridgeCookieMatches(readCookie(req, BRIDGE_COOKIE), transfer.jti)) {
      return fail({ error: "Token not valid for this browser" }, 403);
    }
    try {
      await prisma.consumedToken.create({
        data: { tokenHash: bridgeTokenHash(transfer.jti), pollId: BRIDGE_CONSUMED_KIND },
      });
    } catch (e) {
      // A unique violation means it was already spent; any other error fails closed too.
      const replay = (e as { code?: string })?.code === "P2002";
      return fail({ error: replay ? "Token already used" : "Could not verify token" }, replay ? 401 : 503);
    }
  }

  // Create local session
  const sessionToken = createSessionToken({
    discordId: transfer.discordId,
    username: transfer.username,
    nick: transfer.nick,
    createdAt: Date.now(),
  });

  // Redirect to the requested page, else home - OnboardingWizard.checkSession() handles routing
  const redirectUrl = new URL(next ?? "/", url.origin);

  const res = NextResponse.redirect(redirectUrl.toString());
  const cookieOpts = getSessionCookieOptions(req);
  res.cookies.set(COOKIE_NAME, sessionToken, cookieOpts);

  return bridgeResponse(res, url.origin, !!transfer.jti);
}

/** The redirect leaves no referrer or cache entry behind, and the handover cookie is cleared. */
function bridgeResponse(res: NextResponse, origin: string, spent: boolean): NextResponse {
  for (const [k, v] of Object.entries(BRIDGE_RESPONSE_HEADERS)) res.headers.set(k, v);
  if (spent) res.cookies.set(BRIDGE_COOKIE, "", { ...bridgeCookieOptions(origin), maxAge: 0 });
  return res;
}
