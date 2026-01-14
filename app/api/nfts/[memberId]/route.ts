import { NextRequest, NextResponse } from "next/server";
import { fetchPizzaDAONFTs } from "@/app/lib/nft";

export const runtime = "nodejs";

const SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
const TAB_NAME = "Crew";

// Cache for wallet lookups
const WALLET_CACHE = new Map<string, { time: number; wallet: string | null }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function parseGvizJson(text: string) {
  const cleaned = text.replace(/^\s*\/\*O_o\*\/\s*/m, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("GViz: Unexpected response");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function getWalletForMember(memberId: string): Promise<string | null> {
  // Check cache
  const cached = WALLET_CACHE.get(memberId);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.wallet;
  }

  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${TAB_NAME}&tqx=out:json&headers=0`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch sheet");

  const text = await res.text();
  const gviz = parseGvizJson(text);
  const rows = gviz?.table?.rows || [];

  // Find header row - use same logic as member-lookup (name + status/city)
  let headerRowIdx = -1;
  let headerRowVals: string[] = [];

  for (let ri = 0; ri < Math.min(rows.length, 100); ri++) {
    const rowCells = rows[ri]?.c || [];
    const rowVals = rowCells.map((c: { v?: unknown; f?: unknown }) =>
      String(c?.v || c?.f || "").trim().toLowerCase()
    );
    const hasName = rowVals.includes("name");
    const hasStatus = rowVals.includes("status") || rowVals.includes("frequency");
    const hasCity = rowVals.includes("city") || rowVals.includes("crews");

    if (hasName && (hasStatus || hasCity)) {
      headerRowIdx = ri;
      headerRowVals = rowCells.map((c: { v?: unknown; f?: unknown }) =>
        String(c?.v || c?.f || "").trim().toLowerCase()
      );
      break;
    }
  }

  if (headerRowIdx === -1) {
    WALLET_CACHE.set(memberId, { time: Date.now(), wallet: null });
    return null;
  }

  // Find ID column (default to column 0 if not found, like profile API)
  let idColIdx = headerRowVals.findIndex((h) =>
    ["id", "crewid", "memberid"].includes(h.replace(/[#\s\-_]/g, ""))
  );
  if (idColIdx === -1) idColIdx = 0;

  // Find Wallet column - prefer exact "wallet" match over "wallet address"
  let walletColIdx = headerRowVals.findIndex((h) => h === "wallet");
  if (walletColIdx === -1) {
    walletColIdx = headerRowVals.findIndex((h) => h === "address" || h.includes("wallet"));
  }

  if (walletColIdx === -1) {
    WALLET_CACHE.set(memberId, { time: Date.now(), wallet: null });
    return null;
  }

  const targetId = parseInt(memberId, 10);
  const userRow = rows.slice(headerRowIdx + 1).find((r: { c?: Array<{ v?: unknown }> }) => {
    const val = r?.c?.[idColIdx]?.v;
    return typeof val === "number" ? val === targetId : parseInt(String(val), 10) === targetId;
  });

  const wallet = userRow?.c?.[walletColIdx]?.v;
  const walletAddress =
    wallet && typeof wallet === "string" && wallet.startsWith("0x") ? wallet : null;

  WALLET_CACHE.set(memberId, { time: Date.now(), wallet: walletAddress });
  return walletAddress;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const { memberId } = await params;

    if (!memberId) {
      return NextResponse.json({ error: "Missing member ID" }, { status: 400 });
    }

    // Get wallet address from Google Sheet
    const walletAddress = await getWalletForMember(memberId);

    if (!walletAddress) {
      return NextResponse.json({
        nfts: [],
        totalCount: 0,
        walletAddress: null,
        noWallet: true,
        message: "No wallet address found for this member",
      });
    }

    // Fetch NFTs from Alchemy
    const nftData = await fetchPizzaDAONFTs(walletAddress);

    // Ensure walletAddress and noWallet are always included
    return NextResponse.json({
      ...nftData,
      walletAddress,
      noWallet: false,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch NFTs",
        nfts: [],
        totalCount: 0,
        walletAddress: null,
      },
      { status: 500 }
    );
  }
}
