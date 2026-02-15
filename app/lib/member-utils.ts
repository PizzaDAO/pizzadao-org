import { parseGvizJson } from './gviz-parser';
import { findColumnIndex } from './sheet-utils';
import { GvizCell } from './types/gviz';

const SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
const TAB_NAME = "Crew";

/**
 * Look up a member's memberId and name from their Discord ID.
 * Fetches the Crew sheet and finds the row matching the given discordId.
 */
export async function findMemberByDiscordId(
  discordId: string
): Promise<{ memberId: string; name: string } | null> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(
    TAB_NAME
  )}&tqx=out:json&headers=0`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;

  const text = await res.text();
  const gviz = parseGvizJson(text);
  const rows = gviz?.table?.rows || [];

  // Find header row
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
    const hasCity = rowVals.includes("city") || rowVals.includes("crews");

    if (hasName && (hasStatus || hasCity)) {
      headerRowIdx = ri;
      headerVals = rowCells.map((c: GvizCell) =>
        String(c?.v || c?.f || "").trim()
      );
      break;
    }
  }

  if (headerRowIdx === -1) return null;

  const idxId =
    findColumnIndex(headerVals, ["id", "member id", "memberid"], 0) ?? 0;
  const idxDiscord = findColumnIndex(headerVals, [
    "discordid",
    "discord id",
    "discord",
  ]);
  const idxName = findColumnIndex(headerVals, ["name", "mafia name"]);

  if (idxDiscord == null) return null;

  for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
    const cells = rows[ri]?.c || [];
    const discordVal = String(
      cells[idxDiscord]?.v ?? cells[idxDiscord]?.f ?? ""
    ).trim();

    if (discordVal === discordId) {
      const memberId = String(
        cells[idxId]?.v ?? cells[idxId]?.f ?? ""
      ).trim();
      const name =
        idxName != null
          ? String(cells[idxName]?.v ?? cells[idxName]?.f ?? "").trim()
          : "";
      return { memberId, name };
    }
  }

  return null;
}

/**
 * Convenience: just get the memberId from discordId
 */
export async function findMemberIdByDiscordId(
  discordId: string
): Promise<string | null> {
  const result = await findMemberByDiscordId(discordId);
  return result?.memberId || null;
}
