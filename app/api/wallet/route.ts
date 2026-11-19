import { after, NextRequest, NextResponse } from "next/server";
import { writeToSheet } from "../profile/route";
import { getSession } from "@/app/lib/session";
import { NO_STORE_HEADERS } from "@/app/lib/no-store";
import { fetchMemberById } from "@/app/lib/sheets/member-repository";
import {
  getAllWalletsForMember,
  saveWalletForMember,
  deleteWalletForMember,
  updateWalletForMember,
  setPrimaryWallet,
  getWalletForMember,
} from "@/app/lib/wallet-lookup";
import { clearWalletMatches, refreshRsvEventsIfEnabled } from "@/app/lib/events-attended/rsv";
import { emitMissionEvent } from "@/app/lib/mission-verify/events";
import { promoteAwaitingWallet } from "@/app/lib/slices/claims";
import { processMintQueueSafe } from "@/app/lib/slices/mint-queue";
import { toggleEnabled } from "@/app/lib/settings/toggles";
import { isValidEvmAddress, isValidSolanaAddress } from "@/app/lib/wallet-address";
import { checkKeyedRateLimit, rateLimitResponse } from "@/app/lib/rate-limit";
import { SiweError, requestHost, siweErrorMessage, verifyWalletSiwe } from "@/app/lib/wallet-siwe";

/** A newly linked EVM wallet releases any Call Slices claims that were waiting for one. */
function releaseSliceClaims(discordId: string) {
  after(async () => {
    try {
      if ((await promoteAwaitingWallet(discordId)) > 0) await processMintQueueSafe(10_000);
    } catch (e) {
      console.error("[slices] wallet promote failed:", e instanceof Error ? e.message : e);
    }
  });
}

export const runtime = "nodejs";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_SIGNATURE_LENGTH = 20000;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Verify the authenticated user owns the given memberId.
 * Returns { memberId, discordId } or a NextResponse error.
 */
async function verifyOwnership(
  session: { discordId: string },
  memberId: string
): Promise<{ ok: true; memberId: string; discordId: string } | NextResponse> {
  // Uncached on purpose: this ownership check guards a write.
  const member = await fetchMemberById(memberId, { fresh: true });
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  if (String(member.discordId || "").trim() !== session.discordId) {
    return NextResponse.json(
      { error: "Forbidden: cannot modify another member's wallets" },
      { status: 403 }
    );
  }
  return { ok: true, memberId, discordId: session.discordId };
}

// ---------------------------------------------------------------------------
// Sync primary wallet to Google Sheet
// ---------------------------------------------------------------------------

async function syncPrimaryToSheet(memberId: string): Promise<void> {
  const secret = process.env.GOOGLE_SHEETS_SHARED_SECRET;
  if (!secret) return;

  const primaryAddress = await getWalletForMember(memberId);

  const payload = {
    secret,
    source: "wallet_connect",
    memberId: String(memberId),
    wallet: primaryAddress || "",
    raw: {
      source: "wallet_connect",
      memberId: String(memberId),
      wallet: primaryAddress || "",
    },
  };

  try {
    await writeToSheet(payload);
  } catch {
    // Non-fatal — sheet sync failure shouldn't block wallet operations
  }
}

// ---------------------------------------------------------------------------
// GET — return all wallets for the authenticated user
// ---------------------------------------------------------------------------

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

    const ownership = await verifyOwnership(session, memberId);
    if (ownership instanceof NextResponse) return ownership;

    const wallets = await getAllWalletsForMember(memberId);

    return NextResponse.json({ wallets }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("GET /api/wallet error:", error);
    return NextResponse.json(
      { error: "Failed to fetch wallets" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — add a new wallet
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.discordId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { memberId, walletAddress, chainType = "evm", label, message, signature } = body;

    if (!memberId) {
      return NextResponse.json({ error: "Missing member ID" }, { status: 400 });
    }

    if (typeof walletAddress !== "string") {
      return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
    }

    // Validate wallet address based on chain type
    if (chainType === "evm") {
      if (!walletAddress || !isValidEvmAddress(walletAddress)) {
        return NextResponse.json(
          { error: "Invalid EVM wallet address (must be 0x + 40 hex chars)" },
          { status: 400 }
        );
      }
    } else if (chainType === "solana") {
      if (!walletAddress || !isValidSolanaAddress(walletAddress)) {
        return NextResponse.json(
          { error: "Invalid Solana wallet address" },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { error: "Invalid chain type (must be 'evm' or 'solana')" },
        { status: 400 }
      );
    }

    const ownership = await verifyOwnership(session, memberId);
    if (ownership instanceof NextResponse) return ownership;

    // Wallet ownership verification for new EVM wallets (off by default: see wallets.requireSignature).
    if (chainType === "evm") {
      const required = await toggleEnabled("wallets.requireSignature");
      if (required) {
        if (typeof message !== "string" || typeof signature !== "string" || !message || !signature) {
          return NextResponse.json(
            { error: "Sign a free message with this wallet to prove it is yours", code: "signature_required" },
            { status: 400 }
          );
        }
        if (message.length > MAX_MESSAGE_LENGTH || signature.length > MAX_SIGNATURE_LENGTH) {
          return NextResponse.json({ error: "Signature message is too large", code: "siwe_too_large" }, { status: 400 });
        }
        const limited = await checkKeyedRateLimit("wallet-verify", `${session.discordId}:${memberId}`);
        if (!limited.success) return rateLimitResponse(limited);
        try {
          await verifyWalletSiwe({
            message,
            signature,
            address: walletAddress,
            memberId: String(memberId),
            discordId: session.discordId,
            host: requestHost(request),
          });
        } catch (e) {
          if (e instanceof SiweError) {
            return NextResponse.json({ error: siweErrorMessage(e.code), code: `siwe_${e.code}` }, { status: 400 });
          }
          throw e;
        }
      }
    }

    // Save to DB (auto-primary if first wallet)
    const wallet = await saveWalletForMember(
      String(memberId),
      walletAddress,
      "wallet_connect",
      session.discordId,
      chainType,
      label
    );

    // Sync primary wallet to Google Sheet
    await syncPrimaryToSheet(String(memberId));

    // Re-check missions that look at wallets (background, no-op unless enabled).
    const walletDiscordId = session.discordId;
    // With the signature switch on, a Solana paste does not satisfy the wallet mission, so no re-check.
    if (chainType === "evm" || !(await toggleEnabled("wallets.requireSignature"))) {
      after(() => emitMissionEvent(walletDiscordId, "wallet_connected", { memberId: String(memberId) }).then(() => undefined));
    }
    if (chainType === "evm") {
      releaseSliceClaims(walletDiscordId);
      // New wallet: look for rsv.pizza check-ins made with it (background, no-op unless enabled).
      after(() => refreshRsvEventsIfEnabled(String(memberId)));
    }

    return NextResponse.json({
      success: true,
      message: "Wallet address saved",
      wallet,
    });
  } catch (error: unknown) {
    // Handle unique constraint violation (duplicate wallet)
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "This wallet address is already connected to your account" },
        { status: 409 }
      );
    }
    console.error("POST /api/wallet error:", error);
    return NextResponse.json(
      { error: "Failed to save wallet address" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PUT — update label or set as primary
// ---------------------------------------------------------------------------

export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.discordId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { memberId, walletId, label, isPrimary } = body;

    if (!memberId || !walletId) {
      return NextResponse.json(
        { error: "Missing memberId or walletId" },
        { status: 400 }
      );
    }

    const ownership = await verifyOwnership(session, memberId);
    if (ownership instanceof NextResponse) return ownership;

    // Set primary if requested
    if (isPrimary) {
      await setPrimaryWallet(String(memberId), walletId);
      // Sync new primary to sheet
      await syncPrimaryToSheet(String(memberId));
      releaseSliceClaims(session.discordId);
    }

    // Update label if provided (can be set alongside isPrimary)
    if (label !== undefined) {
      await updateWalletForMember(String(memberId), walletId, {
        label: label || null,
      });
    }

    const wallets = await getAllWalletsForMember(String(memberId));

    return NextResponse.json({ success: true, wallets });
  } catch (error) {
    console.error("PUT /api/wallet error:", error);
    return NextResponse.json(
      { error: "Failed to update wallet" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — remove a wallet
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.discordId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { memberId, walletId } = body;

    if (!memberId || !walletId) {
      return NextResponse.json(
        { error: "Missing memberId or walletId" },
        { status: 400 }
      );
    }

    const ownership = await verifyOwnership(session, memberId);
    if (ownership instanceof NextResponse) return ownership;

    await deleteWalletForMember(String(memberId), walletId);
    // Rows found only through wallets go now, then re-check with the wallets that remain.
    await clearWalletMatches(String(memberId)).catch(() => undefined);
    after(() => refreshRsvEventsIfEnabled(String(memberId)));

    // Sync primary wallet to sheet (may have changed or cleared)
    await syncPrimaryToSheet(String(memberId));

    const wallets = await getAllWalletsForMember(String(memberId));

    return NextResponse.json({ success: true, wallets });
  } catch (error) {
    console.error("DELETE /api/wallet error:", error);
    return NextResponse.json(
      { error: "Failed to delete wallet" },
      { status: 500 }
    );
  }
}
