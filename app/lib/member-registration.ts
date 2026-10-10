import { google } from "googleapis";
import { prisma } from "./db";
import { getGoogleAuth, GOOGLE_SCOPES } from "./google-auth";
import { SHEET_IDS, SHEET_TABS } from "./sheets/config";
import { ValidationError } from "./errors/api-errors";

/** Read the live roster rather than GViz, whose published response can lag writes. */
export function nextMemberId(rows: unknown[][], discordId: string): string {
  const normalized = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[\s_-]/g, "");
  const headerIndex = rows.findIndex(row => row.some(cell => normalized(cell) === "name") && row.some(cell => ["status", "frequency", "city", "crews"].includes(normalized(cell))));
  if (headerIndex < 0) throw new Error("Could not find member roster headers");
  const headers = rows[headerIndex].map(normalized);
  const idIndex = headers.findIndex(header => ["id", "memberid", "crewid"].includes(header));
  const discordIndex = headers.findIndex(header => header === "discordid");
  if (discordIndex < 0) throw new Error("Could not find Discord ID column");
  const taken = new Set<number>();
  for (const row of rows.slice(headerIndex + 1)) {
    if (String(row[discordIndex] ?? "").trim() === discordId) throw new ValidationError("You already have a member profile. Log in to continue.");
    const value = Number(row[idIndex < 0 ? 0 : idIndex]);
    if (Number.isSafeInteger(value) && value > 0) taken.add(value);
  }
  let id = 1;
  while (taken.has(id)) id++;
  return String(id);
}

/**
 * Serialize automatic signups across server instances until the sheet write
 * completes. Apps Script additionally locks writes and rejects identity conflicts.
 * No new table or database migration is needed.
 */
export async function registerWithMemberId<T>(discordId: string, write: (id: string) => Promise<T>): Promise<{ memberId: string; result: T }> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(742019331)`;
    const sheets = google.sheets({ version: "v4", auth: getGoogleAuth([GOOGLE_SCOPES.sheetsReadonly]) });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_IDS.members,
      range: `'${SHEET_TABS.members}'!A:AZ`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const memberId = nextMemberId(response.data.values || [], discordId);
    const result = await write(memberId);
    return { memberId, result };
  }, { timeout: 60000, maxWait: 10000 });
}
