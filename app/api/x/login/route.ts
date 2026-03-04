import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { generateCodeVerifier, generateCodeChallenge, signXState } from "@/app/lib/x-oauth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  // Require Discord session
  const session = await getSession();
  if (!session?.discordId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(req.url);

  // Look up memberId from query param
  const memberId = url.searchParams.get("memberId") || "";

  // Generate PKCE
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Sign state for CSRF
  const state = signXState({ discordId: session.discordId, memberId });

  // Build X OAuth URL
  const clientId = process.env.X_CLIENT_ID!;
  const redirectUri = `${url.origin}/api/x/callback`;

  const authUrl = new URL("https://twitter.com/i/oauth2/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "tweet.read users.read");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  // Set PKCE verifier in httpOnly cookie
  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set("x_pkce_verifier", codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  return res;
}
