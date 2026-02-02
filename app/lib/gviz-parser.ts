/**
 * Parses Google Visualization (GViz) JSON responses
 *
 * GViz wraps JSON responses in either:
 * 1. A comment wrapper: /*O_o*\/\ngoogle.visualization.Query.setResponse({...});
 * 2. Just the function wrapper: google.visualization.Query.setResponse({...})
 *
 * Robust parsing based on sheets-claude MCP implementation.
 */

import { GvizCell, GvizRow, GvizTable, GvizResponse } from './types/gviz';

// Re-export types for convenience
export type { GvizCell, GvizRow, GvizTable, GvizResponse };

/**
 * Parse a GViz response string into structured data
 * Handles both comment wrapper and function wrapper formats.
 */
export function parseGvizJson(text: string): GvizResponse {
  let jsonStr = text;

  // Remove leading comment if present (/*O_o*/)
  if (jsonStr.startsWith('/*')) {
    const commentEnd = jsonStr.indexOf('*/');
    if (commentEnd !== -1) {
      jsonStr = jsonStr.substring(commentEnd + 2).trim();
    }
  }

  // Remove function wrapper if present
  const functionStart = 'google.visualization.Query.setResponse(';
  if (jsonStr.startsWith(functionStart)) {
    jsonStr = jsonStr.substring(functionStart.length);
  }

  // Remove trailing );
  if (jsonStr.endsWith(');')) {
    jsonStr = jsonStr.slice(0, -2);
  } else if (jsonStr.endsWith(')')) {
    jsonStr = jsonStr.slice(0, -1);
  }

  // Fallback: find JSON object bounds
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('GViz: Unexpected response format');
  }

  return JSON.parse(jsonStr.slice(start, end + 1)) as GvizResponse;
}

/**
 * Get a cell value as a string
 * Prefers formatted value (f) over raw value (v) for display purposes
 */
export function getCellValue(cell: GvizCell | null | undefined): string {
  if (!cell) return '';
  // Prefer formatted value if available
  if (cell.f !== undefined && cell.f !== null) {
    return String(cell.f);
  }
  if (cell.v !== undefined && cell.v !== null) {
    return String(cell.v);
  }
  return '';
}

/**
 * Get a cell's raw value (useful for dates, numbers)
 */
export function getCellRawValue(cell: GvizCell | null | undefined): string | number | boolean | null {
  if (!cell) return null;
  return cell.v ?? null;
}

/**
 * Normalize a string for comparison (lowercase, trim, collapse whitespace)
 */
export function normalizeString(s: string): string {
  return String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Detect if a row appears to be a header row based on expected headers
 * Checks if the row contains enough of the expected header values
 */
export function isHeaderRow(row: GvizRow, expectedHeaders: string[]): boolean {
  const rowValues = (row.c || []).map(cell => normalizeString(getCellValue(cell)));
  const lowerExpected = expectedHeaders.map(h => h.toLowerCase());

  // Check if this row contains expected header values
  const matches = lowerExpected.filter(h =>
    rowValues.some(v => v.includes(h) || h.includes(v))
  );

  // If more than half the expected headers match, it's likely a header row
  return matches.length >= expectedHeaders.length / 2;
}

/**
 * Find the header row index in a table by searching for expected headers
 * Searches the first N rows (default 10)
 */
export function findHeaderRowIndex(
  table: GvizTable,
  expectedHeaders: string[],
  maxRowsToSearch: number = 10
): number {
  const rows = table.rows || [];
  for (let i = 0; i < Math.min(maxRowsToSearch, rows.length); i++) {
    if (isHeaderRow(rows[i], expectedHeaders)) {
      return i;
    }
  }
  return -1;
}

/**
 * Find a column index by header name in a specific row (case-insensitive)
 * Returns -1 if not found
 */
export function findColumnInRow(
  row: GvizRow,
  headerName: string
): number {
  const cells = row.c || [];
  const lowerHeader = headerName.toLowerCase();

  for (let i = 0; i < cells.length; i++) {
    const val = normalizeString(getCellValue(cells[i]));
    if (val === lowerHeader || val.includes(lowerHeader)) {
      return i;
    }
  }
  return -1;
}

/**
 * Extract hyperlink from a cell if present
 * Checks for:
 * 1. Direct hyperlink property (l field)
 * 2. URL in raw value
 */
export function extractHyperlink(cell: GvizCell | null | undefined): string | null {
  if (!cell) return null;

  // Check if cell has explicit hyperlink property
  if (cell.l) {
    return cell.l;
  }

  // Check if the raw value is a URL
  const raw = cell.v;
  if (typeof raw === 'string' && raw.startsWith('http')) {
    return raw;
  }

  return null;
}
