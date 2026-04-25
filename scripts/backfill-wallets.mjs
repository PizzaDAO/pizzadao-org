/**
 * Backfill MemberWallet table from Google Sheets Crew tab + UnlockTicketClaim table.
 *
 * Usage:
 *   cp .env.migration .env        # (if not already done)
 *   node scripts/backfill-wallets.mjs
 *
 * Requires: .env with DATABASE_URL
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config({ path: ".env" });

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL in .env");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

const SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
const TAB_NAME = "Crew";

// ---------------------------------------------------------------------------
// 1. Fetch wallets from the Crew sheet via GViz
// ---------------------------------------------------------------------------

async function fetchSheetWallets() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(
    TAB_NAME
  )}&tqx=out:json&headers=0`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);

  const text = await res.text();
  // Strip GViz wrapper: google.visualization.Query.setResponse({...});
  const jsonStr = text.replace(/^[^(]*\(/, "").replace(/\);?\s*$/, "");
  const gviz = JSON.parse(jsonStr);
  const rows = gviz?.table?.rows || [];

  // Find header row
  let headerRowIdx = -1;
  let headerVals = [];

  for (let ri = 0; ri < Math.min(rows.length, 100); ri++) {
    const rowCells = rows[ri]?.c || [];
    const rowValsLower = rowCells.map((c) =>
      String(c?.v || c?.f || "").trim().toLowerCase()
    );
    const hasName = rowValsLower.includes("name");
    const hasStatus =
      rowValsLower.includes("status") || rowValsLower.includes("frequency");
    if (hasName && hasStatus) {
      headerRowIdx = ri;
      headerVals = rowCells.map((c) =>
        String(c?.v || c?.f || "").trim().toLowerCase()
      );
      break;
    }
  }

  if (headerRowIdx === -1) throw new Error("Header row not found in sheet");

  // Find column indices
  let idxId = headerVals.findIndex((h) =>
    ["id", "crewid", "memberid"].includes(h.replace(/[#\s\-_]/g, ""))
  );
  if (idxId === -1) idxId = 0;

  const idxDiscord = headerVals.findIndex(
    (h) => h === "discord id" || h === "discordid" || h === "discord"
  );

  let idxWallet = headerVals.findIndex((h) => h === "wallet");
  if (idxWallet === -1) {
    idxWallet = headerVals.findIndex(
      (h) => h === "address" || h.includes("wallet")
    );
  }

  if (idxWallet === -1) throw new Error("Wallet column not found in sheet");

  console.log(
    `Found columns: id=${idxId}, discord=${idxDiscord}, wallet=${idxWallet}`
  );

  const wallets = [];

  for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
    const cells = rows[ri]?.c || [];
    const id = String(cells[idxId]?.v ?? cells[idxId]?.f ?? "").trim();
    const wallet = String(
      cells[idxWallet]?.v ?? cells[idxWallet]?.f ?? ""
    ).trim();
    const discordId =
      idxDiscord >= 0
        ? String(cells[idxDiscord]?.v ?? cells[idxDiscord]?.f ?? "").trim()
        : null;

    if (id && wallet && wallet.startsWith("0x") && wallet.length >= 42) {
      wallets.push({
        memberId: id,
        walletAddress: wallet,
        discordId: discordId || null,
      });
    }
  }

  return wallets;
}

// ---------------------------------------------------------------------------
// 2. Fetch wallets from UnlockTicketClaim table
// ---------------------------------------------------------------------------

async function fetchUnlockWallets() {
  const rows = await sql`
    SELECT "memberId", "walletAddress", "discordId"
    FROM "UnlockTicketClaim"
    WHERE "walletAddress" IS NOT NULL AND "walletAddress" != ''
  `;
  return rows.map((r) => ({
    memberId: String(r.memberId),
    walletAddress: r.walletAddress,
    discordId: r.discordId || null,
    source: "unlock",
  }));
}

// ---------------------------------------------------------------------------
// 3. Upsert into MemberWallet
// ---------------------------------------------------------------------------

async function upsertWallet(memberId, walletAddress, source, discordId) {
  const now = new Date().toISOString();
  await sql`
    INSERT INTO "MemberWallet" ("memberId", "walletAddress", "source", "discordId", "createdAt", "updatedAt")
    VALUES (${memberId}, ${walletAddress}, ${source}, ${discordId}, ${now}, ${now})
    ON CONFLICT ("memberId") DO UPDATE SET
      "walletAddress" = EXCLUDED."walletAddress",
      "source" = EXCLUDED."source",
      "discordId" = COALESCE(EXCLUDED."discordId", "MemberWallet"."discordId"),
      "updatedAt" = ${now}
  `;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Backfill MemberWallet ===\n");

  // Sheet wallets
  console.log("Fetching wallets from Crew sheet...");
  const sheetWallets = await fetchSheetWallets();
  console.log(`Found ${sheetWallets.length} wallets in sheet`);

  let sheetCount = 0;
  for (const w of sheetWallets) {
    try {
      await upsertWallet(w.memberId, w.walletAddress, "sheet", w.discordId);
      sheetCount++;
    } catch (err) {
      console.error(`  Failed member ${w.memberId}: ${err.message}`);
    }
  }
  console.log(`Backfilled ${sheetCount} wallets from sheet\n`);

  // Unlock wallets (may overwrite sheet wallets with more up-to-date data)
  console.log("Fetching wallets from UnlockTicketClaim...");
  const unlockWallets = await fetchUnlockWallets();
  console.log(`Found ${unlockWallets.length} wallets in UnlockTicketClaim`);

  let unlockCount = 0;
  for (const w of unlockWallets) {
    try {
      await upsertWallet(
        w.memberId,
        w.walletAddress,
        "unlock",
        w.discordId
      );
      unlockCount++;
    } catch (err) {
      console.error(`  Failed member ${w.memberId}: ${err.message}`);
    }
  }
  console.log(`Backfilled ${unlockCount} wallets from Unlock claims\n`);

  // Summary
  const total =
    await sql`SELECT COUNT(*) as count FROM "MemberWallet"`;
  console.log(`=== Done: ${total[0].count} total wallets in MemberWallet ===`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
