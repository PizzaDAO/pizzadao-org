// app/api/discord/callback/route.ts
import { NextResponse } from "next/server";

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
  } catch {}

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

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") || ""; // sessionId

    if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });

    const token = await exchangeCodeForToken(code);
    const me = await fetchDiscordMe(token.access_token);

    const joinResult = await addUserToGuild(me.id, token.access_token);

    const back = new URL("/", url.origin);
    back.searchParams.set("discordId", me.id);
    if (state) back.searchParams.set("sessionId", state);
    back.searchParams.set("discordJoined", joinResult.joined ? "1" : "0");

    return NextResponse.redirect(back.toString());
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Discord callback failed" }, { status: 500 });
  }
}
