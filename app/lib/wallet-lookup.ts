import { prisma } from "@/app/lib/db";
import { parseGvizJson } from "@/app/lib/gviz-parser";
import { findColumnIndex } from "@/app/lib/sheet-utils";
import { GvizResponse, GvizCell } from "@/app/lib/types/gviz";

const SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
const TAB_NAME = "Crew";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WalletRecord {
  id: number;
  memberId: string;
  discordId: string | null;
  walletAddress: string;
  label: string | null;
  chainType: string;
  source: string;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Look up PRIMARY wallet for a member: DB first, sheet fallback + auto-cache.
 * Backward-compatible for sheet sync and existing consumers.
 */
export async function getWalletForMember(
  memberId: string
): Promise<string | null> {
  // 1. Try DB — get primary wallet
  const primary = await prisma.memberWallet.findFirst({
    where: { memberId, isPrimary: true },
    select: { walletAddress: true },
  });
  if (primary) return primary.walletAddress;

  // 1b. If no primary, try any wallet for this member
  const any = await prisma.memberWallet.findFirst({
    where: { memberId },
    orderBy: { createdAt: "asc" },
    select: { walletAddress: true },
  });
  if (any) return any.walletAddress;

  // 2. Fall back to sheet
  const sheetWallet = await fetchWalletFromSheet(memberId);
  if (!sheetWallet) return null;

  // 3. Auto-cache in DB as primary
  try {
    await prisma.memberWallet.create({
      data: {
        memberId,
        walletAddress: sheetWallet,
        source: "sheet",
        isPrimary: true,
      },
    });
  } catch {
    // Unique constraint or other non-fatal error
  }

  return sheetWallet;
}

/**
 * Return ALL wallets for a member (used by NFT/POAP/UI).
 */
export async function getAllWalletsForMember(
  memberId: string
): Promise<WalletRecord[]> {
  return prisma.memberWallet.findMany({
    where: { memberId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
}

/**
 * Return only EVM wallets for a member (NFT/POAP consumers).
 */
export async function getEvmWalletsForMember(
  memberId: string
): Promise<string[]> {
  const wallets = await prisma.memberWallet.findMany({
    where: { memberId, chainType: "evm" },
    select: { walletAddress: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  return wallets.map((w) => w.walletAddress);
}

/**
 * Get all member wallets from DB (for leaderboard).
 * Returns all wallets grouped by member.
 * Falls back to sheet if DB is empty (pre-backfill).
 */
export async function getAllMemberWallets(): Promise<
  Array<{ memberId: string; walletAddress: string }>
> {
  const dbWallets = await prisma.memberWallet.findMany({
    where: { chainType: "evm" },
    select: { memberId: true, walletAddress: true },
  });
  if (dbWallets.length > 0) return dbWallets;

  // Fallback to sheet
  return fetchAllWalletsFromSheet();
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

/**
 * Save a new wallet for a member. First wallet is automatically primary.
 */
export async function saveWalletForMember(
  memberId: string,
  walletAddress: string,
  source: string = "wallet_connect",
  discordId?: string,
  chainType: string = "evm",
  label?: string
): Promise<WalletRecord> {
  // Check if member has any existing wallets
  const existingCount = await prisma.memberWallet.count({
    where: { memberId },
  });
  const isPrimary = existingCount === 0;

  return prisma.memberWallet.create({
    data: {
      memberId,
      walletAddress,
      source,
      discordId,
      chainType,
      label,
      isPrimary,
    },
  });
}

/**
 * Delete a wallet for a member. If deleted wallet was primary, promote next oldest.
 */
export async function deleteWalletForMember(
  memberId: string,
  walletId: number
): Promise<void> {
  const wallet = await prisma.memberWallet.findFirst({
    where: { id: walletId, memberId },
  });
  if (!wallet) throw new Error("Wallet not found");

  await prisma.memberWallet.delete({ where: { id: walletId } });

  // If deleted wallet was primary, promote next oldest
  if (wallet.isPrimary) {
    const next = await prisma.memberWallet.findFirst({
      where: { memberId },
      orderBy: { createdAt: "asc" },
    });
    if (next) {
      await prisma.memberWallet.update({
        where: { id: next.id },
        data: { isPrimary: true },
      });
    }
  }
}

/**
 * Update wallet label or other editable fields.
 */
export async function updateWalletForMember(
  memberId: string,
  walletId: number,
  updates: { label?: string }
): Promise<WalletRecord> {
  // Verify ownership
  const wallet = await prisma.memberWallet.findFirst({
    where: { id: walletId, memberId },
  });
  if (!wallet) throw new Error("Wallet not found");

  return prisma.memberWallet.update({
    where: { id: walletId },
    data: { label: updates.label },
  });
}

/**
 * Set a wallet as primary (unset old primary, set new).
 */
export async function setPrimaryWallet(
  memberId: string,
  walletId: number
): Promise<void> {
  // Verify ownership
  const wallet = await prisma.memberWallet.findFirst({
    where: { id: walletId, memberId },
  });
  if (!wallet) throw new Error("Wallet not found");

  // Unset all primaries for this member, then set the new one
  await prisma.$transaction([
    prisma.memberWallet.updateMany({
      where: { memberId, isPrimary: true },
      data: { isPrimary: false },
    }),
    prisma.memberWallet.update({
      where: { id: walletId },
      data: { isPrimary: true },
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Internal: Google Sheets helpers
// ---------------------------------------------------------------------------

/**
 * Fetch wallet for a single member from the Crew Google Sheet (GViz API).
 * Extracted from the original inline logic in the NFT/POAP routes.
 */
async function fetchWalletFromSheet(
  memberId: string
): Promise<string | null> {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(
      TAB_NAME
    )}&tqx=out:json&headers=0`;

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;

    const text = await res.text();
    const gviz: GvizResponse = parseGvizJson(text);
    const rows = gviz?.table?.rows || [];

    // Find header row (same logic as member-repository.ts)
    let headerRowIdx = -1;
    let headerVals: string[] = [];

    for (let ri = 0; ri < Math.min(rows.length, 100); ri++) {
      const rowCells = rows[ri]?.c || [];
      const rowVals = rowCells.map((c: GvizCell) =>
        String(c?.v || c?.f || "").trim().toLowerCase()
      );
      const hasName = rowVals.includes("name");
      const hasStatus =
        rowVals.includes("status") || rowVals.includes("frequency");
      const hasCity =
        rowVals.includes("city") || rowVals.includes("crews");

      if (hasName && (hasStatus || hasCity)) {
        headerRowIdx = ri;
        headerVals = rowCells.map((c: GvizCell) =>
          String(c?.v || c?.f || "").trim()
        );
        break;
      }
    }

    if (headerRowIdx === -1) return null;

    // Find ID and Wallet columns
    const idxId =
      findColumnIndex(headerVals, ["id", "member id", "memberid"], 0) ?? 0;
    const idxWallet = findColumnIndex(headerVals, [
      "wallet",
      "wallet address",
      "eth address",
      "address",
    ]);

    if (idxWallet == null) return null;

    // Find member row
    const targetId = parseInt(memberId, 10);
    for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
      const cells = rows[ri]?.c || [];
      const idVal = cells[idxId]?.v;
      const numericId =
        typeof idVal === "number"
          ? idVal
          : parseInt(String(idVal ?? ""), 10);

      if (numericId === targetId) {
        const walletVal = String(
          cells[idxWallet]?.v ?? cells[idxWallet]?.f ?? ""
        ).trim();
        return walletVal && walletVal.startsWith("0x") ? walletVal : null;
      }
    }

    return null;
  } catch (error) {
    console.error("Error fetching wallet from sheet:", error);
    return null;
  }
}

/**
 * Fetch all member wallets from the Crew Google Sheet (GViz API).
 * Extracted from the original fetchMembersWithWallets() in the leaderboard route.
 */
async function fetchAllWalletsFromSheet(): Promise<
  Array<{ memberId: string; walletAddress: string }>
> {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${TAB_NAME}&tqx=out:json&headers=0`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];

    const text = await res.text();
    const gviz = parseGvizJson(text);
    const rows = gviz?.table?.rows || [];

    // Find header row
    let headerRowIdx = -1;
    let headerVals: string[] = [];

    for (let ri = 0; ri < Math.min(rows.length, 100); ri++) {
      const rowCells = rows[ri]?.c || [];
      const rowValsLower = rowCells.map((c: GvizCell) =>
        String(c?.v || c?.f || "").trim().toLowerCase()
      );
      const hasName = rowValsLower.includes("name");
      const hasStatus =
        rowValsLower.includes("status") ||
        rowValsLower.includes("frequency");
      if (hasName && hasStatus) {
        headerRowIdx = ri;
        headerVals = rowCells.map((c: GvizCell) =>
          String(c?.v || c?.f || "").trim().toLowerCase()
        );
        break;
      }
    }

    if (headerRowIdx === -1) return [];

    // Find column indices
    let idxId = headerVals.findIndex((h) =>
      ["id", "crewid", "memberid"].includes(h.replace(/[#\s\-_]/g, ""))
    );
    if (idxId === -1) idxId = 0;

    let idxWallet = headerVals.findIndex((h) => h === "wallet");
    if (idxWallet === -1) {
      idxWallet = headerVals.findIndex(
        (h) => h === "address" || h.includes("wallet")
      );
    }

    if (idxWallet === -1) return [];

    const results: Array<{ memberId: string; walletAddress: string }> = [];

    for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
      const cells = rows[ri]?.c || [];
      const id = String(cells[idxId]?.v ?? cells[idxId]?.f ?? "").trim();
      const wallet = String(
        cells[idxWallet]?.v ?? cells[idxWallet]?.f ?? ""
      ).trim();

      if (
        id &&
        wallet &&
        wallet.startsWith("0x") &&
        wallet.length >= 42
      ) {
        results.push({
          memberId: id,
          walletAddress: wallet.toLowerCase(),
        });
      }
    }

    return results;
  } catch (error) {
    console.error("Error fetching all wallets from sheet:", error);
    return [];
  }
}
