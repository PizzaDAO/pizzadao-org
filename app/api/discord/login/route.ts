import { NextResponse } from "next/server";
import {
  isPreviewEnvironment,
  getProductionOrigin,
  validateReturnTo,
  encodeOAuthState,
  generateOAuthNonce,
  oauthStateCookieOptions,
  OAUTH_STATE_COOKIE,
} from "@/app/lib/oauth-proxy";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") || "";
  const returnTo = url.searchParams.get("return_to") || "";
  // join=1 is the explicit second step for people who are NOT yet in the
  // PizzaDAO Discord: only then do we ask Discord for guilds.join.
  const join = url.searchParams.get("join") === "1";

  // Preview detection: redirect to production login
  if (isPreviewEnvironment() && !returnTo) {
    const productionLogin = new URL("/api/discord/login", getProductionOrigin());
    productionLogin.searchParams.set("return_to", url.origin);
    if (state) productionLogin.searchParams.set("state", state);
    if (join) productionLogin.searchParams.set("join", "1");
    return NextResponse.redirect(productionLogin.toString());
  }

  // Validate return_to if present
  if (returnTo && !validateReturnTo(returnTo)) {
    return NextResponse.json({ error: "Invalid return_to URL" }, { status: 400 });
  }

  const clientId = process.env.DISCORD_CLIENT_ID!;
  const redirectUri = process.env.DISCORD_REDIRECT_URI || `${url.origin}/api/discord/callback`;

  // The oauth_state cookie must be set on the same host the callback runs on.
  // If this login was hit on a different host (e.g. a *.vercel.app alias of
  // production), hop to the callback's host first.
  const callbackOrigin = new URL(redirectUri).origin;
  if (callbackOrigin !== url.origin) {
    const canonical = new URL("/api/discord/login", callbackOrigin);
    url.searchParams.forEach((v, k) => canonical.searchParams.set(k, v));
    return NextResponse.redirect(canonical.toString());
  }

  const nonce = generateOAuthNonce();

  const auth = new URL("https://discord.com/api/oauth2/authorize");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  // Default login only identifies the user. guilds.join ("join servers for
  // you") is requested only on the explicit join step.
  auth.searchParams.set("scope", join ? "identify guilds.join" : "identify");
  if (join) auth.searchParams.set("prompt", "consent");
  auth.searchParams.set(
    "state",
    encodeOAuthState({ sessionId: state, return_to: returnTo || undefined, nonce, join }),
  );

  const res = NextResponse.redirect(auth.toString());
  res.cookies.set(OAUTH_STATE_COOKIE, nonce, oauthStateCookieOptions(req));
  return res;
}
