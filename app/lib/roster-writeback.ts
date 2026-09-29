/**
 * Roster Write-back — add/remove one crew in one member's "Crews" cell in the
 * Crew Google Sheet.
 *
 * Safety model:
 * - Dry-run is the default. Nothing is written unless `mode: "apply"`.
 * - Apply requires `expectedBefore`: the exact cell value the admin saw in
 *   the dry-run preview. If the cell changed since, the write is refused
 *   (409) instead of clobbering someone else's edit.
 * - The new value is computed from the LIVE cell value read via the Sheets
 *   API (not the 5-minute gviz cache), and only the target crew token is
 *   added/removed; every other token is preserved.
 * - Exactly one cell is written: the Crews column of the single row whose ID
 *   column equals memberId. Zero or duplicate ID matches are refused, and the
 *   ID cell is re-verified immediately before writing.
 * - Formula cells are never overwritten; values are written RAW (no formula
 *   evaluation of user-supplied text).
 * - Idempotent: adding a crew that is already present, or removing one that
 *   is absent, is a no-op with no write.
 *
 * Uses a dedicated read-write sheets client (the shared sheetsClient only has
 * readonly scope).
 */

import { google, type sheets_v4 } from "googleapis";
import { __clearMembersCache } from "@/app/lib/sheets/members-list";
import { findColumnIndex } from "@/app/lib/sheet-utils";
import { getCrewMappings } from "@/app/lib/crew-mappings";
import { normalizeCrewId, splitCrewList, CREW_ID_PATTERN } from "@/app/lib/crew-id";

export const ROSTER_SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
export const ROSTER_TAB_NAME = "Crew";
const HEADER_SCAN_ROWS = 100;

export type RosterAction = "add" | "remove";
export type WritebackMode = "dry-run" | "apply";

export interface UpdateMemberCrewsInput {
  memberId: string;
  crewId: string;
  action: RosterAction;
  mode?: WritebackMode;
  /** Required for mode "apply": the `before` value returned by the dry run. */
  expectedBefore?: string;
}

export interface UpdateMemberCrewsResult {
  mode: WritebackMode;
  /** True only when a write was actually sent to the sheet. */
  applied: boolean;
  /** False when the requested change is already reflected (no-op). */
  changed: boolean;
  range: string;
  before: string;
  after: string;
  crews: string[];
}

export class RosterWritebackError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RosterWritebackError";
  }
}

type SheetsValuesApi = Pick<sheets_v4.Resource$Spreadsheets$Values, "get" | "update">;

export interface WritebackDeps {
  values: SheetsValuesApi;
  /** Resolve a crew ID to its canonical label, or null if unknown. */
  resolveCrewLabel: (crewId: string) => Promise<string | null>;
  clearCache: () => void;
}

// ---------------------------------------------------------------------------
// Pure planning
// ---------------------------------------------------------------------------

export interface CrewsCellPlan {
  changed: boolean;
  before: string;
  after: string;
  crews: string[];
}

/**
 * Compute the new Crews cell value. Only the target crew token is touched.
 * Adding appends to the original text verbatim; removing rejoins the
 * remaining tokens (in original order) with ", ".
 */
export function planCrewsCellUpdate(
  before: string,
  crewId: string,
  action: RosterAction,
  crewLabel?: string
): CrewsCellPlan {
  const tokens = splitCrewList(before);
  const matches = (t: string) => normalizeCrewId(t) === crewId;

  if (action === "add") {
    if (tokens.some(matches)) {
      return { changed: false, before, after: before, crews: tokens };
    }
    const label = (crewLabel ?? "").trim();
    if (!label || /[,/|]/.test(label) || normalizeCrewId(label) !== crewId) {
      throw new RosterWritebackError(`Invalid label for crew ${crewId}`, 400);
    }
    const trimmed = before.trim();
    const after = trimmed ? `${trimmed}, ${label}` : label;
    return { changed: true, before, after, crews: [...tokens, label] };
  }

  const kept = tokens.filter((t) => !matches(t));
  if (kept.length === tokens.length) {
    return { changed: false, before, after: before, crews: tokens };
  }
  return { changed: true, before, after: kept.join(", "), crews: kept };
}

export function colIndexToLetter(idx: number): string {
  if (!Number.isInteger(idx) || idx < 0) throw new Error(`Invalid column index ${idx}`);
  let letter = "";
  let n = idx;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

// ---------------------------------------------------------------------------
// Sheet access
// ---------------------------------------------------------------------------

function getWriteClient(): sheets_v4.Sheets {
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

async function defaultResolveCrewLabel(crewId: string): Promise<string | null> {
  const { crews } = await getCrewMappings();
  const crew = crews.find((c) => c.id === crewId);
  return crew?.label?.trim() || null;
}

function defaultDeps(): WritebackDeps {
  return {
    values: getWriteClient().spreadsheets.values,
    resolveCrewLabel: defaultResolveCrewLabel,
    clearCache: __clearMembersCache,
  };
}

const q = (range: string) => `'${ROSTER_TAB_NAME}'!${range}`;

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

interface Located {
  row: number; // 1-indexed sheet row
  idCol: string;
  crewsCol: string;
}

/** Locate the header row, ID/Crews columns and the member's unique row. */
async function locateMemberRow(values: SheetsValuesApi, memberId: string): Promise<Located> {
  const headerResp = await values.get({
    spreadsheetId: ROSTER_SHEET_ID,
    range: q(`1:${HEADER_SCAN_ROWS}`),
  });
  const headerRows = (headerResp.data.values || []) as unknown[][];

  // Same header detection as app/lib/sheets/members-list.ts (the reader).
  let headerRowIdx = -1;
  let headers: string[] = [];
  for (let ri = 0; ri < headerRows.length; ri++) {
    const raw = (headerRows[ri] || []).map((v) => cellToString(v).trim());
    const lower = raw.map((v) => v.toLowerCase());
    const hasName = lower.includes("name");
    const hasStatus = lower.includes("status") || lower.includes("frequency");
    const hasCity = lower.includes("city") || lower.includes("crews");
    if (hasName && (hasStatus || hasCity)) {
      headerRowIdx = ri;
      headers = raw;
      break;
    }
  }
  if (headerRowIdx === -1) {
    throw new RosterWritebackError("Could not find header row in Crew sheet", 500);
  }

  const crewsColIdx = findColumnIndex(headers, ["crews", "crew"]);
  const idColIdx = findColumnIndex(headers, ["id", "crew id", "member id"], 0) ?? 0;
  if (crewsColIdx === null) {
    throw new RosterWritebackError("Could not find Crews column in Crew sheet", 500);
  }
  if (crewsColIdx === idColIdx) {
    throw new RosterWritebackError("ID and Crews columns resolved to the same column", 500);
  }

  const idCol = colIndexToLetter(idColIdx);
  const crewsCol = colIndexToLetter(crewsColIdx);
  const dataStartRow = headerRowIdx + 2; // 1-indexed row after the header

  const idResp = await values.get({
    spreadsheetId: ROSTER_SHEET_ID,
    range: q(`${idCol}${dataStartRow}:${idCol}`),
  });
  const idValues = (idResp.data.values || []) as unknown[][];
  const hits: number[] = [];
  for (let i = 0; i < idValues.length; i++) {
    if (cellToString(idValues[i]?.[0]).trim() === memberId) hits.push(i);
  }
  if (hits.length === 0) {
    throw new RosterWritebackError(`Member ${memberId} not found in Crew sheet`, 404);
  }
  if (hits.length > 1) {
    throw new RosterWritebackError(
      `Member ID ${memberId} appears on ${hits.length} rows; refusing to write`,
      409
    );
  }
  return { row: dataStartRow + hits[0], idCol, crewsCol };
}

/** Read the row's ID cell and raw (formula-aware) Crews cell. */
async function readRow(values: SheetsValuesApi, loc: Located) {
  const [idResp, crewsResp] = await Promise.all([
    values.get({ spreadsheetId: ROSTER_SHEET_ID, range: q(`${loc.idCol}${loc.row}`) }),
    values.get({
      spreadsheetId: ROSTER_SHEET_ID,
      range: q(`${loc.crewsCol}${loc.row}`),
      valueRenderOption: "FORMULA",
    }),
  ]);
  return {
    id: cellToString(idResp.data.values?.[0]?.[0]).trim(),
    crewsRaw: crewsResp.data.values?.[0]?.[0],
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function updateMemberCrews(
  input: UpdateMemberCrewsInput,
  deps: WritebackDeps = defaultDeps()
): Promise<UpdateMemberCrewsResult> {
  const { memberId, action } = input;
  const mode: WritebackMode = input.mode ?? "dry-run";
  const crewId = normalizeCrewId(input.crewId);

  if (typeof memberId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(memberId)) {
    throw new RosterWritebackError("Invalid memberId", 400);
  }
  if (!crewId || !CREW_ID_PATTERN.test(crewId) || crewId.length > 64) {
    throw new RosterWritebackError("Invalid crewId", 400);
  }
  if (action !== "add" && action !== "remove") {
    throw new RosterWritebackError("action must be 'add' or 'remove'", 400);
  }
  if (mode !== "dry-run" && mode !== "apply") {
    throw new RosterWritebackError("mode must be 'dry-run' or 'apply'", 400);
  }
  if (mode === "apply" && typeof input.expectedBefore !== "string") {
    throw new RosterWritebackError("expectedBefore is required to apply", 400);
  }

  // Only add crews that exist in Crew Mappings, using their canonical label.
  let crewLabel: string | undefined;
  if (action === "add") {
    const label = await deps.resolveCrewLabel(crewId);
    if (!label) throw new RosterWritebackError(`Unknown crew: ${crewId}`, 400);
    crewLabel = label;
  }

  const loc = await locateMemberRow(deps.values, memberId);
  const range = q(`${loc.crewsCol}${loc.row}`);
  const current = await readRow(deps.values, loc);

  if (current.id !== memberId) {
    throw new RosterWritebackError("Sheet changed while reading; retry", 409);
  }
  if (typeof current.crewsRaw === "string" && current.crewsRaw.trim().startsWith("=")) {
    throw new RosterWritebackError("Crews cell contains a formula; edit it manually", 409);
  }
  const before = cellToString(current.crewsRaw);
  const plan = planCrewsCellUpdate(before, crewId, action, crewLabel);

  const result: UpdateMemberCrewsResult = {
    mode,
    applied: false,
    changed: plan.changed,
    range,
    before: plan.before,
    after: plan.after,
    crews: plan.crews,
  };

  // Idempotent no-op, or preview only.
  if (!plan.changed || mode === "dry-run") return result;

  if (input.expectedBefore !== before) {
    throw new RosterWritebackError(
      "Crews cell changed since the preview; re-run the dry run",
      409
    );
  }

  // Re-verify the row immediately before writing (guards against rows being
  // inserted/sorted between the lookup and the write).
  const recheck = await readRow(deps.values, loc);
  if (recheck.id !== memberId || cellToString(recheck.crewsRaw) !== before) {
    throw new RosterWritebackError("Sheet changed while writing; retry", 409);
  }

  await deps.values.update({
    spreadsheetId: ROSTER_SHEET_ID,
    range,
    valueInputOption: "RAW",
    requestBody: { range, majorDimension: "ROWS", values: [[plan.after]] },
  });

  deps.clearCache();
  return { ...result, applied: true };
}
