import { parseGvizJson } from '../gviz-parser';
import { findColumnIndex } from '../sheet-utils';
import { GvizResponse, GvizCell } from '../types/gviz';

const SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
const TAB_NAME = "Crew";

export interface MemberSheetData {
  [key: string]: string | number | boolean | undefined;
  discordId?: string;
}

/**
 * Fetch member data from Google Sheets by member ID
 * Replaces duplicated fetchMemberRowById() in profile, update-skills, claim-member routes
 */
export async function fetchMemberById(memberId: string): Promise<MemberSheetData | null> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(
    TAB_NAME
  )}&tqx=out:json&headers=0`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);

  const text = await res.text();
  const gviz: GvizResponse = parseGvizJson(text);
  const rows = gviz?.table?.rows || [];

  // Find header row
  let headerRowIdx = -1;
  let headerVals: string[] = [];

  for (let ri = 0; ri < Math.min(rows.length, 100); ri++) {
    const rowCells = rows[ri]?.c || [];
    const rowVals = rowCells.map((c: GvizCell) => String(c?.v || c?.f || "").trim().toLowerCase());
    const hasName = rowVals.includes("name");
    const hasStatus = rowVals.includes("status") || rowVals.includes("frequency");
    const hasCity = rowVals.includes("city") || rowVals.includes("crews");

    if (hasName && (hasStatus || hasCity)) {
      headerRowIdx = ri;
      headerVals = rowCells.map((c: GvizCell) => String(c?.v || c?.f || "").trim());
      break;
    }
  }

  if (headerRowIdx === -1) throw new Error("Header row not found");

  // Find ID column
  const idxId = findColumnIndex(headerVals, ["id", "member id", "memberid"], 0) ?? 0;
  const idxDiscord = findColumnIndex(headerVals, ["discordid", "discord id", "discord"]);

  // Find member row
  for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
    const cells = rows[ri]?.c || [];
    const idVal = String(cells[idxId]?.v ?? cells[idxId]?.f ?? "").trim();

    if (idVal && idVal === memberId) {
      const discordVal = idxDiscord != null
        ? String(cells[idxDiscord]?.v ?? cells[idxDiscord]?.f ?? "").trim()
        : "";

      const data: MemberSheetData = { discordId: discordVal };
      headerVals.forEach((key, idx) => {
        if (key) {
          data[key] = cells[idx]?.v ?? cells[idx]?.f;
        }
      });

      return data;
    }
  }

  return null;
}
