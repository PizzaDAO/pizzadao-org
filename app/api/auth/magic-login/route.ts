import { NextResponse } from "next/server";
import { verifyMagicToken } from "@/app/lib/magic-login";
import { createSessionToken, getSessionCookieOptions, COOKIE_NAME } from "@/app/lib/session";
import { syncRolesOnLogin } from "@/app/lib/sync-roles-on-login";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawToken = url.searchParams.get("token");

  if (!rawToken) {
    return NextResponse.redirect(
      new URL("/?loginError=missing_token", url.origin).toString(),
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
      new URL(`/?loginError=${errorMap[result.reason]}`, url.origin).toString(),
    );
  }

  // Create session — identical to OAuth flow
  const sessionToken = createSessionToken({
    discordId: result.discordId,
    username: result.username,
    nick: result.nick ?? undefined,
    createdAt: Date.now(),
  });

  // Check for existing member record
  let redirectUrl: URL;
  try {
    const lookupRes = await fetch(
      `${url.origin}/api/member-lookup/${result.discordId}`,
      { cache: "no-store" },
    );
    if (lookupRes.ok) {
      const lookup = await lookupRes.json();
      if (lookup.found && lookup.memberId) {
        redirectUrl = new URL(`/dashboard/${lookup.memberId}`, url.origin);

        // Fire-and-forget role sync
        syncRolesOnLogin(
          url.origin,
          result.discordId,
          lookup.memberId,
          lookup.name ?? result.nick ?? result.username,
        ).catch(() => {});
      } else {
        // New user — redirect to onboarding with Discord info
        redirectUrl = new URL("/", url.origin);
        redirectUrl.searchParams.set("discordId", result.discordId);
        redirectUrl.searchParams.set("discordJoined", "1");
        if (result.nick) redirectUrl.searchParams.set("discordNick", result.nick);
      }
    } else {
      // Lookup failed — go to onboarding
      redirectUrl = new URL("/", url.origin);
      redirectUrl.searchParams.set("discordId", result.discordId);
      redirectUrl.searchParams.set("discordJoined", "1");
      if (result.nick) redirectUrl.searchParams.set("discordNick", result.nick);
    }
  } catch {
    // Fallback — still create session and send to home
    redirectUrl = new URL("/", url.origin);
    redirectUrl.searchParams.set("discordId", result.discordId);
    redirectUrl.searchParams.set("discordJoined", "1");
  }

  const res = NextResponse.redirect(redirectUrl.toString());
  const cookieOpts = getSessionCookieOptions(req);
  res.cookies.set(COOKIE_NAME, sessionToken, cookieOpts);
  return res;
}
