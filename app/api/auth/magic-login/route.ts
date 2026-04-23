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

  // Look up member by Discord ID, with searchName fallback so we can
  // find users whose sheet entry exists by name but isn't yet linked
  // by Discord ID. This mirrors the wizard's handleDiscordCallback
  // behavior so the magic-login flow can auto-link accounts.
  const searchName = result.nick ?? result.username;
  let memberId: string | undefined;
  let memberName: string | undefined;

  try {
    const lookupRes = await fetch(
      `${url.origin}/api/member-lookup/${result.discordId}?searchName=${encodeURIComponent(searchName)}`,
      { cache: "no-store" },
    );
    if (lookupRes.ok) {
      const lookup = await lookupRes.json();
      if (lookup.found && lookup.memberId) {
        memberId = String(lookup.memberId);
        memberName = lookup.memberName;
      }
    }
  } catch {
    // Lookup failure is non-fatal — we'll still create the session
    // and send the user to onboarding.
  }

  // Always sync Discord roles + Discord ID to the sheet — mirrors OAuth
  // callback. When member-lookup found the row by name match, this
  // writes the user's Discord ID into that row (since the GAS script
  // searches by memberId first, then writes discordId to that row).
  syncRolesOnLogin(
    url.origin,
    result.discordId,
    memberId,
    memberName ?? result.nick ?? result.username,
  ).catch(() => {});

  // Build redirect URL
  let redirectUrl: URL;
  if (memberId) {
    redirectUrl = new URL(`/dashboard/${memberId}`, url.origin);
  } else {
    // New user — redirect to onboarding with Discord info
    redirectUrl = new URL("/", url.origin);
    redirectUrl.searchParams.set("discordId", result.discordId);
    redirectUrl.searchParams.set("discordJoined", "1");
    if (result.nick) redirectUrl.searchParams.set("discordNick", result.nick);
  }

  const res = NextResponse.redirect(redirectUrl.toString());
  const cookieOpts = getSessionCookieOptions(req);
  res.cookies.set(COOKIE_NAME, sessionToken, cookieOpts);
  return res;
}
