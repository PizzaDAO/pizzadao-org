import { NextRequest, NextResponse } from "next/server";
import { recoverMessageAddress } from "viem";
import {
  getSession,
  createSessionToken,
  COOKIE_NAME,
  getSessionCookieOptions,
} from "@/app/lib/session";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.discordId) {
      return NextResponse.redirect(new URL("/", req.url));
    }

    const codeParam = req.nextUrl.searchParams.get("code");
    if (!codeParam) {
      return NextResponse.redirect(new URL("/", req.url));
    }

    // Decode base64 code parameter
    let decoded: { d: string; s: `0x${string}` };
    try {
      const json = Buffer.from(codeParam, "base64").toString("utf-8");
      decoded = JSON.parse(json);
    } catch {
      return NextResponse.redirect(new URL("/", req.url));
    }

    if (!decoded.d || !decoded.s) {
      return NextResponse.redirect(new URL("/", req.url));
    }

    // Recover wallet address from SIWE signature
    const walletAddress = await recoverMessageAddress({
      message: decoded.d,
      signature: decoded.s,
    });

    // Look up memberId for redirect
    const memberId = await fetchMemberIdByDiscordId(session.discordId);
    if (!memberId) {
      return NextResponse.redirect(new URL("/", req.url));
    }

    // Re-sign session with unlockWallet added
    const updatedSession = { ...session, unlockWallet: walletAddress };
    const token = createSessionToken(updatedSession);

    const redirectUrl = new URL(`/profile/${memberId}`, req.url);
    redirectUrl.searchParams.set("unlock", "verified");

    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set(COOKIE_NAME, token, getSessionCookieOptions(req));

    return response;
  } catch (error) {
    console.error("Unlock callback error:", error);
    return NextResponse.redirect(new URL("/", req.url));
  }
}
