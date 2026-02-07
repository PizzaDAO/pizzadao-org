import { NextResponse } from "next/server";
import { createSessionToken, getSessionCookieOptions, COOKIE_NAME } from "@/app/lib/session";
import { verifyTransferToken } from "@/app/lib/oauth-proxy";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing transfer token" }, { status: 400 });
  }

  const transfer = verifyTransferToken(token);
  if (!transfer) {
    return NextResponse.json({ error: "Invalid or expired transfer token" }, { status: 401 });
  }

  // Verify origin matches
  if (transfer.origin !== url.origin) {
    return NextResponse.json({ error: "Token not valid for this origin" }, { status: 403 });
  }

  // Create local session
  const sessionToken = createSessionToken({
    discordId: transfer.discordId,
    username: transfer.username,
    nick: transfer.nick,
    createdAt: Date.now(),
  });

  // Redirect to home - OnboardingWizard.checkSession() handles routing
  const redirectUrl = new URL("/", url.origin);

  const res = NextResponse.redirect(redirectUrl.toString());
  const cookieOpts = getSessionCookieOptions(req);
  res.cookies.set(COOKIE_NAME, sessionToken, cookieOpts);

  return res;
}
