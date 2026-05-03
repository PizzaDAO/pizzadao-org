/**
 * Roster Write-back — update the "Crews" column in the Crew Google Sheet.
 *
 * Uses a dedicated sheets client with read-write scope (the shared sheetsClient
 * only has readonly scope).
 */

import { google } from "googleapis";
import { fetchAllMembers, __clearMembersCache } from "@/app/lib/sheets/members-list";

const SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
const TAB_NAME = "Crew";

// Read-write sheets client (separate from the readonly one in api/lib/google-sheets)
function getWriteClient() {
  let credentials;
  try {
    credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
      : undefined;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

/**
 * Add or remove a crew from a member's "Crews" cell in the Google Sheet.
 *
 * Steps:
 * 1. Fetch all members to find current crews list + row position
 * 2. Modify the crews list
 * 3. Write back via Sheets API
 * 4. Clear cache
 */
export async function updateMemberCrews(
  memberId: string,
  crewId: string,
  action: "add" | "remove"
): Promise<{ success: boolean; crews: string[] }> {
  // Fetch members with Discord IDs to find the target
  const members = await fetchAllMembers({ includeDiscordId: true, includeUnonboarded: true });
  const member = members.find(m => m.id === memberId);

  if (!member) {
    throw new Error(`Member ${memberId} not found`);
  }

  // Normalize crewId to display format (e.g., "biz_dev" → "Biz Dev")
  const crewLabel = crewId
    .split("_")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  let updatedCrews: string[];

  if (action === "add") {
    // Don't add if already present (case-insensitive)
    const already = member.crews.some(
      c => c.toLowerCase().replace(/\s+/g, "_") === crewId.toLowerCase()
    );
    if (already) {
      return { success: true, crews: member.crews };
    }
    updatedCrews = [...member.crews, crewLabel];
  } else {
    updatedCrews = member.crews.filter(
      c => c.toLowerCase().replace(/\s+/g, "_") !== crewId.toLowerCase()
    );
    if (updatedCrews.length === member.crews.length) {
      // Nothing to remove
      return { success: true, crews: member.crews };
    }
  }

  // Find the row in the sheet. We need to locate the member by ID.
  // The sheet row = headerRow + 1 + index of member in parsed list.
  // But since fetchAllMembers filters, we need the raw row index.
  // Instead, use Sheets API to find the row by searching column A (ID column).
  const sheets = getWriteClient();

  // Get the header row to find the "Crews" column letter
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${TAB_NAME}'!1:100`,
  });

  const headerRows = headerResp.data.values || [];
  let headerRowIdx = -1;
  let crewsColIdx = -1;
  let idColIdx = -1;

  for (let ri = 0; ri < headerRows.length; ri++) {
    const row = headerRows[ri].map((v: unknown) => String(v ?? "").trim().toLowerCase());
    const hasName = row.includes("name");
    const hasCrews = row.includes("crews") || row.includes("crew");

    if (hasName && hasCrews) {
      headerRowIdx = ri;
      crewsColIdx = row.findIndex((h: string) => h === "crews" || h === "crew");
      idColIdx = row.findIndex((h: string) => h === "id" || h === "crew id" || h === "member id");
      if (idColIdx === -1) idColIdx = 0;
      break;
    }
  }

  if (headerRowIdx === -1 || crewsColIdx === -1) {
    throw new Error("Could not find header row or Crews column in sheet");
  }

  // Now find the member's row by scanning the ID column
  const idColLetter = colIndexToLetter(idColIdx);
  const dataStartRow = headerRowIdx + 2; // 1-indexed, +1 for header, +1 for data start
  const idColResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${TAB_NAME}'!${idColLetter}${dataStartRow}:${idColLetter}5000`,
  });

  const idValues = idColResp.data.values || [];
  let memberRowOffset = -1;
  for (let i = 0; i < idValues.length; i++) {
    const val = String(idValues[i]?.[0] ?? "").trim();
    if (val === memberId) {
      memberRowOffset = i;
      break;
    }
  }

  if (memberRowOffset === -1) {
    throw new Error(`Member ${memberId} not found in sheet ID column`);
  }

  const memberSheetRow = dataStartRow + memberRowOffset;
  const crewsColLetter = colIndexToLetter(crewsColIdx);
  const cellRange = `'${TAB_NAME}'!${crewsColLetter}${memberSheetRow}`;

  // Write the updated crews value
  const newValue = updatedCrews.join(", ");
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: cellRange,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[newValue]] },
  });

  // Clear cached member data so subsequent reads reflect the change
  __clearMembersCache();

  return { success: true, crews: updatedCrews };
}

function colIndexToLetter(idx: number): string {
  let letter = "";
  let n = idx;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}
