// app/api/discord/callback/route.ts
import { NextResponse } from "next/server";
import { createSessionToken, getSessionCookieOptions, COOKIE_NAME } from "@/app/lib/session";
import { decodeOAuthState, validateReturnTo, createTransferToken } from "@/app/lib/oauth-proxy";
import { syncRolesOnLogin } from "@/app/lib/sync-roles-on-login";

export const runtime = "nodejs";

async function exchangeCodeForToken(code: string, redirectUri: string) {
  const body = new URLSearchParams();
  body.set("client_id", process.env.DISCORD_CLIENT_ID!);
  body.set("client_secret", process.env.DISCORD_CLIENT_SECRET!);
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);

  const r = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await r.json();
  if (!r.ok) throw new Error(data?.error_description || "Token exchange failed");

  return data as { access_token: string; token_type: string; scope: string; expires_in: number };
}

async function fetchDiscordMe(accessToken: string) {
  const r = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.message || "Failed to fetch /users/@me");
  return data as { id: string; username: string; global_name?: string };
}

async function addUserToGuild(discordUserId: string, userAccessToken: string) {
  const guildId = process.env.DISCORD_GUILD_ID!;
  const botToken = process.env.DISCORD_BOT_TOKEN!;

  const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${botToken}`,
    },
    body: JSON.stringify({ access_token: userAccessToken }),
  });

  // Success cases
  if (r.status === 201 || r.status === 204) return { joined: true };

  // Try to interpret body (Discord often returns JSON error payloads)
  const text = await r.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch { }

  // Defensive: if Discord says "already a member", treat as joined.
  // (Some endpoints use code 30007; keeping this tolerant.)
  const msg = String(data?.message ?? text ?? "");
  const code = data?.code;
  const looksAlreadyMember =
    code === 30007 ||
    /already.*member/i.test(msg) ||
    /member.*exists/i.test(msg);

  if (looksAlreadyMember) return { joined: true };

  throw new Error(`guilds.join failed (${r.status}): ${text}`);
}


interface GuildMember {
  nick?: string;
  user?: {
    global_name?: string;
    username: string;
  };
}

async function fetchGuildMember(userId: string): Promise<GuildMember | null> {
  const guildId = process.env.DISCORD_GUILD_ID!;
  const botToken = process.env.DISCORD_BOT_TOKEN!;
  const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (!r.ok) return null;
  return await r.json();
}

// Check if user already has a member ID in the sheet (via member-lookup)
async function checkExistingMember(discordId: string, origin: string): Promise<{ memberId?: string; name?: string } | null> {
  try {
    const res = await fetch(`${origin}/api/member-lookup/${discordId}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.memberId) {
      return { memberId: data.memberId, name: data.name };
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawState = url.searchParams.get("state") || "";
    const { return_to } = decodeOAuthState(rawState);

    // Handle OAuth errors (e.g. user clicked "Cancel" on Discord authorization screen)
    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      // If this was a proxy flow, redirect back to the preview origin
      if (return_to && validateReturnTo(return_to)) {
        return NextResponse.redirect(return_to);
      }
      // Otherwise redirect to home page
      return NextResponse.redirect(new URL("/", url.origin).toString());
    }

    const code = url.searchParams.get("code");
    const { sessionId: state } = decodeOAuthState(rawState);

    // No code and no error — something unexpected; redirect home gracefully
    if (!code) {
      return NextResponse.redirect(new URL("/", url.origin).toString());
    }

    const redirectUri = process.env.DISCORD_REDIRECT_URI || `${url.origin}/api/discord/callback`;
    const token = await exchangeCodeForToken(code, redirectUri);
    const me = await fetchDiscordMe(token.access_token);

    const joinResult = await addUserToGuild(me.id, token.access_token);
    const guildMember = await fetchGuildMember(me.id);

    const nick = guildMember?.nick || guildMember?.user?.global_name || me.username;

    // If this is a proxy flow (return_to exists), create transfer token
    // and redirect back to the preview
    if (return_to && validateReturnTo(return_to)) {
      const transferToken = createTransferToken({
        discordId: me.id,
        username: me.username,
        nick: nick,
        origin: return_to,
      });

      const transferUrl = new URL("/api/auth/session-transfer", return_to);
      transferUrl.searchParams.set("token", transferToken);
      return NextResponse.redirect(transferUrl.toString());
    }

    // Create session token
    const sessionToken = createSessionToken({
      discordId: me.id,
      username: me.username,
      nick: nick,
      createdAt: Date.now(),
    });

    // Check if user already has a member record
    const existingMember = await checkExistingMember(me.id, url.origin);

    // Fire-and-forget: sync Discord roles to the sheet on every login.
    // This is intentionally not awaited so it never blocks the redirect.
    syncRolesOnLogin(
      url.origin,
      me.id,
      existingMember?.memberId,
      existingMember?.name ?? nick,
    ).catch(() => {}); // extra safety net

    // Build redirect URL
    let redirectUrl: URL;
    if (existingMember?.memberId) {
      // Existing member - go directly to dashboard
      redirectUrl = new URL(`/dashboard/${existingMember.memberId}`, url.origin);
    } else {
      // New user - go to home page with params
      redirectUrl = new URL("/", url.origin);
      redirectUrl.searchParams.set("discordId", me.id);
      if (state) redirectUrl.searchParams.set("sessionId", state);
      redirectUrl.searchParams.set("discordJoined", joinResult.joined ? "1" : "0");
      if (nick) redirectUrl.searchParams.set("discordNick", nick);
    }

    // Create response and set session cookie
    const res = NextResponse.redirect(redirectUrl.toString());
    const cookieOpts = getSessionCookieOptions(req);
    res.cookies.set(COOKIE_NAME, sessionToken, cookieOpts);

    return res;
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as any)?.message || "Discord callback failed" }, { status: 500 });
  }
}
