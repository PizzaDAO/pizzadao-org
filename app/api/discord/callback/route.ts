// app/api/discord/callback/route.ts
import { NextResponse } from "next/server";
import { signSession, COOKIE_NAME, getSessionCookieOptions } from "@/app/lib/session";

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

  if (r.status === 201 || r.status === 204) return { joined: true };

  const text = await r.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch { }

  const msg = String(data?.message ?? text ?? "");
  const code = data?.code;
  const looksAlreadyMember =
    code === 30007 || /already.*member/i.test(msg) || /member.*exists/i.test(msg);

  if (looksAlreadyMember) return { joined: true };

  throw new Error(`guilds.join failed (${r.status}): ${text}`);
}

interface GuildMember {
  nick?: string;
  user?: { global_name?: string; username: string };
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

    // ✅ Set signed session cookie (works on localhost + prod)
    const ttlSeconds = 60 * 60 * 24 * 14; // 14 days
    const signed = signSession(
      { discordId: me.id, username: me.username, nick },
      ttlSeconds
    );

    // ✅ Check if member already exists - redirect directly to dashboard
    let redirectUrl: URL;
    try {
      const lookupUrl = new URL(`/api/member-lookup/${me.id}`, url.origin);
      if (nick) lookupUrl.searchParams.set("searchName", nick);
      const lookupRes = await fetch(lookupUrl.toString());

      if (lookupRes.ok) {
        const data = await lookupRes.json();
        if (data.found && data.memberId) {
          // Member exists - redirect directly to dashboard
          redirectUrl = new URL(`/dashboard/${data.memberId}`, url.origin);
        } else {
          // Not found - go to home page for onboarding
          redirectUrl = new URL("/", url.origin);
          redirectUrl.searchParams.set("discordId", me.id);
          if (state) redirectUrl.searchParams.set("sessionId", state);
          redirectUrl.searchParams.set("discordJoined", joinResult.joined ? "1" : "0");
          if (nick) redirectUrl.searchParams.set("discordNick", nick);
        }
      } else {
        // Lookup failed - go to home page
        redirectUrl = new URL("/", url.origin);
        redirectUrl.searchParams.set("discordId", me.id);
        if (state) redirectUrl.searchParams.set("sessionId", state);
        redirectUrl.searchParams.set("discordJoined", joinResult.joined ? "1" : "0");
        if (nick) redirectUrl.searchParams.set("discordNick", nick);
      }
    } catch {
      // Error - fall back to home page
      redirectUrl = new URL("/", url.origin);
      redirectUrl.searchParams.set("discordId", me.id);
      if (state) redirectUrl.searchParams.set("sessionId", state);
      redirectUrl.searchParams.set("discordJoined", joinResult.joined ? "1" : "0");
      if (nick) redirectUrl.searchParams.set("discordNick", nick);
    }

    const res = NextResponse.redirect(redirectUrl.toString());
    res.cookies.set(COOKIE_NAME, signed, getSessionCookieOptions(ttlSeconds));
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Discord callback failed" }, { status: 500 });
  }
}
