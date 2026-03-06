import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyXState, encryptToken } from "@/app/lib/x-oauth";
import { prisma } from "@/app/lib/db";
import { fetchWithRedirect } from "@/app/lib/sheet-utils";

export const runtime = "nodejs";

async function exchangeCodeForToken(code: string, codeVerifier: string, redirectUri: string) {
  const clientId = process.env.X_CLIENT_ID!;
  const clientSecret = process.env.X_CLIENT_SECRET!;

  const body = new URLSearchParams();
  body.set("code", code);
  body.set("grant_type", "authorization_code");
  body.set("redirect_uri", redirectUri);
  body.set("code_verifier", codeVerifier);

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const r = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body,
  });

  const data = await r.json();
  if (!r.ok) throw new Error(data?.error_description || data?.detail || "Token exchange failed");
  return data as { access_token: string; refresh_token?: string; token_type: string; expires_in: number };
}

async function fetchXUser(accessToken: string) {
  const r = await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url,username,name", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.detail || "Failed to fetch X user");
  return data.data as { id: string; username: string; name: string; profile_image_url?: string };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // Check for OAuth errors (e.g. user denied)
    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      return NextResponse.redirect(new URL("/?x_error=cancelled", url.origin).toString());
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") || "";

    if (!code) {
      return NextResponse.redirect(new URL("/?x_error=no_code", url.origin).toString());
    }

    // Verify state (CSRF)
    const stateData = verifyXState(state);
    if (!stateData) {
      return NextResponse.redirect(new URL("/?x_error=invalid_state", url.origin).toString());
    }

    // Get PKCE verifier from cookie
    const cookieStore = await cookies();
    const codeVerifier = cookieStore.get("x_pkce_verifier")?.value;
    if (!codeVerifier) {
      return NextResponse.redirect(new URL("/?x_error=missing_verifier", url.origin).toString());
    }

    // Exchange code for token
    const redirectUri = `${url.origin}/api/x/callback`;
    const tokenData = await exchangeCodeForToken(code, codeVerifier, redirectUri);

    // Fetch X user info
    const xUser = await fetchXUser(tokenData.access_token);

    // Upsert XAccount
    await (prisma as any).xAccount.upsert({
      where: { discordId: stateData.discordId },
      update: {
        xId: xUser.id,
        xUsername: xUser.username,
        xDisplayName: xUser.name,
        xProfileImageUrl: xUser.profile_image_url || null,
        accessToken: encryptToken(tokenData.access_token),
        refreshToken: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : null,
        memberId: stateData.memberId || null,
      },
      create: {
        discordId: stateData.discordId,
        memberId: stateData.memberId || null,
        xId: xUser.id,
        xUsername: xUser.username,
        xDisplayName: xUser.name,
        xProfileImageUrl: xUser.profile_image_url || null,
        accessToken: encryptToken(tokenData.access_token),
        refreshToken: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : null,
      },
    });

    // Write X username to Google Sheet
    const sheetsUrl = process.env.GOOGLE_SHEETS_WEBAPP_URL;
    const sheetsSecret = process.env.GOOGLE_SHEETS_SHARED_SECRET;
    if (sheetsUrl && sheetsSecret && stateData.memberId) {
      try {
        await fetchWithRedirect(sheetsUrl, {
          secret: sheetsSecret,
          source: "x-connect",
          memberId: stateData.memberId,
          discordId: stateData.discordId,
          x: xUser.username,
        });
      } catch (sheetErr) {
        console.error("X sheet write failed:", sheetErr);
      }
    } else {
      console.warn("X sheet write skipped — missing:", {
        sheetsUrl: !!sheetsUrl,
        sheetsSecret: !!sheetsSecret,
        memberId: stateData.memberId,
      });
    }

    // Clear PKCE cookie and redirect to dashboard
    const memberId = stateData.memberId;
    const redirectTo = memberId ? `/dashboard/${memberId}?x_connected=1` : `/?x_connected=1`;

    const res = NextResponse.redirect(new URL(redirectTo, url.origin).toString());
    res.cookies.delete("x_pkce_verifier");
    return res;
  } catch (e: unknown) {
    console.error("X OAuth callback error:", e);
    return NextResponse.json({ error: (e as any)?.message || "X OAuth failed" }, { status: 500 });
  }
}
