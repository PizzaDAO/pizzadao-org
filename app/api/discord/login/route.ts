import { NextResponse } from "next/server";
import {
  isPreviewEnvironment,
  getProductionOrigin,
  validateReturnTo,
  encodeOAuthState,
} from "@/app/lib/oauth-proxy";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") || "";
  const returnTo = url.searchParams.get("return_to") || "";

  // Preview detection: redirect to production login
  if (isPreviewEnvironment() && !returnTo) {
    const productionLogin = new URL("/api/discord/login", getProductionOrigin());
    productionLogin.searchParams.set("return_to", url.origin);
    if (state) productionLogin.searchParams.set("state", state);
    return NextResponse.redirect(productionLogin.toString());
  }

  // Validate return_to if present
  if (returnTo && !validateReturnTo(returnTo)) {
    return NextResponse.json({ error: "Invalid return_to URL" }, { status: 400 });
  }

  const clientId = process.env.DISCORD_CLIENT_ID!;
  const redirectUri = process.env.DISCORD_REDIRECT_URI || `${url.origin}/api/discord/callback`;

  const auth = new URL("https://discord.com/api/oauth2/authorize");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "identify guilds.join");

  const encodedState = encodeOAuthState(state, returnTo || undefined);
  if (encodedState) auth.searchParams.set("state", encodedState);

  return NextResponse.redirect(auth.toString());
}
