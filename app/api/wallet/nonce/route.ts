import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { NO_STORE_HEADERS } from "@/app/lib/no-store";
import { fetchMemberById } from "@/app/lib/sheets/member-repository";
import { toggleEnabled } from "@/app/lib/settings/toggles";
import { checkKeyedRateLimit, rateLimitResponse } from "@/app/lib/rate-limit";
import { issueWalletNonce, walletStatement } from "@/app/lib/wallet-siwe";

export const runtime = "nodejs";

/**
 * GET /api/wallet/nonce?memberId= : a single-use, 10-minute nonce bound to the signed-in member,
 * for the wallet ownership message. Also says whether a signature is currently required.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.discordId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const memberId = request.nextUrl.searchParams.get("memberId");
    if (!memberId) {
      return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
    }

    const limited = await checkKeyedRateLimit("wallet-nonce", session.discordId);
    if (!limited.success) return rateLimitResponse(limited);

    const member = await fetchMemberById(memberId, { fresh: true });
    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    if (String(member.discordId || "").trim() !== session.discordId) {
      return NextResponse.json({ error: "Forbidden: cannot modify another member's wallets" }, { status: 403 });
    }

    const required = await toggleEnabled("wallets.requireSignature");
    const { nonce, expiresAt } = issueWalletNonce(String(memberId), session.discordId);
    return NextResponse.json(
      { nonce, expiresAt, required, statement: walletStatement(String(memberId)) },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("GET /api/wallet/nonce error:", error);
    return NextResponse.json({ error: "Failed to issue nonce" }, { status: 500 });
  }
}
