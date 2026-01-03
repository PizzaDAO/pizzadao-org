import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") || ""; // pass sessionId here

  const clientId = process.env.DISCORD_CLIENT_ID!;
  const redirectUri = process.env.DISCORD_REDIRECT_URI!;

  const auth = new URL("https://discord.com/api/oauth2/authorize");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "identify guilds.join");
  if (state) auth.searchParams.set("state", state);

  return NextResponse.redirect(auth.toString());
}
