import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import {
  getSession,
  createSessionToken,
  COOKIE_NAME,
  getSessionCookieOptions,
} from "@/app/lib/session";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.discordId) {
      return NextResponse.json({ error: "Not logged in" }, { status: 401 });
    }

    const { message, signature, address } = await req.json();

    if (!message || !signature || !address) {
      return NextResponse.json(
        { error: "Missing message, signature, or address" },
        { status: 400 }
      );
    }

    // Verify the signature matches the claimed address
    const valid = await verifyMessage({
      message,
      signature: signature as `0x${string}`,
      address: address as `0x${string}`,
    });

    if (!valid) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 400 }
      );
    }

    // Store wallet in session
    const updatedSession = { ...session, unlockWallet: address };
    const token = createSessionToken(updatedSession);

    const response = NextResponse.json({ ok: true, walletAddress: address });
    response.cookies.set(COOKIE_NAME, token, getSessionCookieOptions(req));

    return response;
  } catch (error) {
    console.error("Wallet verification error:", error);
    return NextResponse.json(
      { error: "Verification failed" },
      { status: 500 }
    );
  }
}
