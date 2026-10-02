import { prisma } from "@/app/lib/db";
import {
  MEMBER_COLUMNS,
  cellText,
  findMemberRow,
  getMembersSheet,
  memberIdColumn,
  membersColumn,
} from "@/app/lib/sheets/member-repository";

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
 * Fetch wallet for a single member from the Crew Google Sheet.
 * Reads through the members repository (Next data cache, tag "members").
 */
async function fetchWalletFromSheet(
  memberId: string
): Promise<string | null> {
  try {
    const sheet = await getMembersSheet();

    const idxWallet = membersColumn(sheet, MEMBER_COLUMNS.wallet);
    if (idxWallet == null) return null;

    const row = findMemberRow(sheet, memberId);
    if (!row) return null;

    const walletVal = cellText(row.c?.[idxWallet]);
    return walletVal && walletVal.startsWith("0x") ? walletVal : null;
  } catch (error) {
    console.error("Error fetching wallet from sheet:", error);
    return null;
  }
}

/**
 * Fetch all member wallets from the Crew Google Sheet.
 * Reads through the members repository (Next data cache, tag "members").
 */
async function fetchAllWalletsFromSheet(): Promise<
  Array<{ memberId: string; walletAddress: string }>
> {
  try {
    const sheet = await getMembersSheet();

    const idxId = memberIdColumn(sheet);

    // Exact "wallet" header first, then "address" or anything containing "wallet".
    const lowerHeaders = sheet.headers.map((h) => h.toLowerCase());
    let idxWallet = lowerHeaders.findIndex((h) => h === "wallet");
    if (idxWallet === -1) {
      idxWallet = lowerHeaders.findIndex(
        (h) => h === "address" || h.includes("wallet")
      );
    }

    if (idxWallet === -1) return [];

    const results: Array<{ memberId: string; walletAddress: string }> = [];

    for (const row of sheet.rows) {
      const cells = row?.c || [];
      const id = cellText(cells[idxId]);
      const wallet = cellText(cells[idxWallet]);

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
