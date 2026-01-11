// app/api/discord/callback/route.ts
import { NextResponse } from "next/server";
import { createSessionToken, getSessionCookieOptions, COOKIE_NAME } from "@/app/lib/session";

export const runtime = "nodejs";

async function exchangeCodeForToken(code: string) {
  const body = new URLSearchParams();
  body.set("client_id", process.env.DISCORD_CLIENT_ID!);
  body.set("client_secret", process.env.DISCORD_CLIENT_SECRET!);
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", process.env.DISCORD_REDIRECT_URI!);

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
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") || ""; // sessionId

    if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });

    const token = await exchangeCodeForToken(code);
    const me = await fetchDiscordMe(token.access_token);

    const joinResult = await addUserToGuild(me.id, token.access_token);
    const guildMember = await fetchGuildMember(me.id);

    const nick = guildMember?.nick || guildMember?.user?.global_name || me.username;

    // Create session token
    const sessionToken = createSessionToken({
      discordId: me.id,
      username: me.username,
      nick: nick,
      createdAt: Date.now(),
    });

    // Check if user already has a member record
    const existingMember = await checkExistingMember(me.id, url.origin);

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
    console.log("[callback] Setting session cookie:", {
      cookieName: COOKIE_NAME,
      tokenLength: sessionToken.length,
      cookieOpts,
      redirectTo: redirectUrl.toString()
    });
    res.cookies.set(COOKIE_NAME, sessionToken, cookieOpts);

    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Discord callback failed" }, { status: 500 });
  }
}
