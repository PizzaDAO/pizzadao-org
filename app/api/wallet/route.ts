import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import path from "path";

export const runtime = "nodejs";

const SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
const TAB_NAME = "Crew";

// Initialize Google Sheets API with write access
let credentials;
try {
  credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    : undefined;
} catch {
  console.error("Error parsing GOOGLE_SERVICE_ACCOUNT_JSON");
}

const auth = new google.auth.GoogleAuth({
  credentials,
  keyFile: !credentials ? path.join(process.cwd(), "service-account.json") : undefined,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

function parseGvizJson(text: string) {
  const cleaned = text.replace(/^\s*\/\*O_o\*\/\s*/m, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("GViz: Unexpected response");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { memberId, walletAddress } = body;

    if (!memberId) {
      return NextResponse.json({ error: "Missing member ID" }, { status: 400 });
    }

    if (!walletAddress || !walletAddress.startsWith("0x") || walletAddress.length !== 42) {
      return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
    }

    // Get sheet metadata to find header row and wallet column
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
      return NextResponse.json({ error: "Could not find header row" }, { status: 500 });
    }

    // Find ID and Wallet column indices
    let idColIdx = headerRowVals.findIndex((h) =>
      ["id", "crewid", "memberid"].includes(h.toLowerCase().replace(/[#\s\-_]/g, ""))
    );
    if (idColIdx === -1) idColIdx = 0;

    let walletColIdx = headerRowVals.findIndex((h) => h.toLowerCase() === "wallet");
    if (walletColIdx === -1) {
      walletColIdx = headerRowVals.findIndex((h) => h.toLowerCase() === "address" || h.toLowerCase().includes("wallet"));
    }

    if (walletColIdx === -1) {
      return NextResponse.json({ error: "Missing Wallet column in sheet" }, { status: 500 });
    }

    // Find the member's row
    const targetId = parseInt(memberId, 10);
    let memberRowIdx = -1;
    let foundId: any = null;

    console.log(`[wallet] Looking for member ID ${targetId} in column ${idColIdx}`);

    for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
      const cells = rows[ri]?.c || [];
      const val = cells[idColIdx]?.v;
      const rowId = typeof val === "number" ? val : parseInt(String(val), 10);
      if (rowId === targetId) {
        memberRowIdx = ri;
        foundId = val;
        console.log(`[wallet] Found member ${targetId} at row ${ri}, ID value in cell: ${val}`);
        break;
      }
    }

    if (memberRowIdx === -1) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    // Convert column index to letter (A, B, C, ..., Z, AA, AB, ...)
    function colToLetter(col: number): string {
      let letter = "";
      while (col >= 0) {
        letter = String.fromCharCode((col % 26) + 65) + letter;
        col = Math.floor(col / 26) - 1;
      }
      return letter;
    }

    // Update the wallet cell (row is 1-indexed in Sheets API)
    const cellRange = `${TAB_NAME}!${colToLetter(walletColIdx)}${memberRowIdx + 1}`;

    console.log(`[wallet] Writing to cell ${cellRange} for member ${memberId}`);
    console.log(`[wallet] Header row: ${headerRowIdx}, wallet col: ${walletColIdx}, member row: ${memberRowIdx}`);
    console.log(`[wallet] Headers found:`, headerRowVals);

    const updateResult = await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: cellRange,
      valueInputOption: "RAW",
      requestBody: {
        values: [[walletAddress]],
      },
    });

    console.log(`[wallet] Update result:`, JSON.stringify(updateResult.data));
    console.log(`[wallet] Updated wallet for member ${memberId} to ${walletAddress}`);

    return NextResponse.json({
      success: true,
      message: "Wallet address saved",
      walletAddress,
      debug: {
        cellRange,
        headerRow: headerRowIdx,
        idCol: idColIdx,
        walletCol: walletColIdx,
        memberRow: memberRowIdx,
        foundIdValue: foundId,
        headers: headerRowVals.slice(0, 15), // First 15 headers for debug
        updateResult: updateResult.data,
      }
    });
  } catch (error) {
    console.error("[wallet] Error saving wallet:", error);
    return NextResponse.json(
      { error: "Failed to save wallet address" },
      { status: 500 }
    );
  }
}
