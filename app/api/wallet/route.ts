import { NextRequest, NextResponse } from "next/server";
import { writeToSheet } from "../profile/route";
import { getSession } from "@/app/lib/session";
import { fetchMemberById } from "@/app/lib/sheets/member-repository";
import {
  getAllWalletsForMember,
  saveWalletForMember,
  deleteWalletForMember,
  updateWalletForMember,
  setPrimaryWallet,
  getWalletForMember,
} from "@/app/lib/wallet-lookup";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isValidEvmAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function isValidSolanaAddress(addr: string): boolean {
  // Base58 characters: 1-9, A-H, J-N, P-Z, a-k, m-z (no 0, I, O, l)
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

/**
 * Verify the authenticated user owns the given memberId.
 * Returns { memberId, discordId } or a NextResponse error.
 */
async function verifyOwnership(
  session: { discordId: string },
  memberId: string
): Promise<{ ok: true; memberId: string; discordId: string } | NextResponse> {
  const member = await fetchMemberById(memberId);
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

    return NextResponse.json({ wallets });
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
    const { memberId, walletAddress, chainType = "evm", label } = body;

    if (!memberId) {
      return NextResponse.json({ error: "Missing member ID" }, { status: 400 });
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
