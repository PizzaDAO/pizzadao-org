/**
 * Generic table parser for Google Sheets data
 *
 * Provides robust parsing with:
 * - Anchor-based table detection (finds tables by anchor keywords like "Manuals", "Tasks")
 * - Dynamic header row detection
 * - Tables mode handling (Google Sheets filter dropdowns cause malformed GViz data)
 *
 * Based on sheets-claude MCP implementation.
 */

import {
  GvizTable,
  GvizRow,
  GvizCell,
  getCellValue,
  normalizeString,
} from './gviz-parser';

/**
 * Configuration for parsing a specific table type
 */
export interface TableConfig {
  /** Keywords to find the table anchor (e.g., ["manuals", "manual"]) */
  anchorKeywords?: string[];

  /**
   * Header mappings: [normalizedName, possibleHeaders[]]
   * Order matters for disambiguation (e.g., "lead id" before "lead")
   */
  headerMappings: [string, string[]][];

  /** Minimum required columns to consider a row as the header row */
  requiredColumns?: string[];
}

/**
 * Result of finding table headers
 */
export interface TableHeaderResult {
  headerRowIndex: number;
  columns: Record<string, number>;
}

/**
 * Detect if GViz data is from a Google Sheets Table (Tables mode)
 *
 * In Tables mode, the GViz API returns malformed data:
 * - Column labels are concatenated strings with metadata + header + data values
 * - The first row of data is actual task data, not headers
 *
 * Detection heuristics:
 * 1. Column labels are longer than 50 characters with spaces
 * 2. Labels contain multiple values separated by spaces
 */
export function isTablesModeDetected(table: GvizTable): boolean {
  const cols = table.cols || [];

  if (cols.length === 0) return false;

  // Check if any column label is suspiciously long (concatenated values)
  for (const col of cols) {
    const label = col.label || '';
    // Tables mode labels are typically very long with multiple words/values
    if (label.length > 50 && label.includes(' ')) {
      // Additional check: look for patterns like "Value1 Value2 Value3"
      // that suggest concatenation of header + data values
      const wordCount = label.split(/\s+/).length;
      if (wordCount > 5) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Find table headers using anchor-based detection
 *
 * Strategy:
 * 1. Find the anchor row (e.g., a cell containing "Manuals")
 * 2. Search nearby rows for the actual header row
 * 3. Map column indices based on header mappings
 *
 * Falls back to searching from row 0 if no anchor is found.
 */
export function findTableHeaders(
  table: GvizTable,
  config: TableConfig
): TableHeaderResult | null {
  const rows = table.rows || [];
  const cols = table.cols || [];

  // Phase 1: Find the anchor row (if anchor keywords are provided)
  let anchorRowIndex = -1;

  if (config.anchorKeywords && config.anchorKeywords.length > 0) {
    const anchorKeywordsLower = config.anchorKeywords.map(k => k.toLowerCase());

    for (let ri = 0; ri < rows.length && ri < 20; ri++) {
      const rowCells = rows[ri]?.c || [];
      for (let ci = 0; ci < rowCells.length; ci++) {
        const val = normalizeString(getCellValue(rowCells[ci]));
        if (anchorKeywordsLower.some(keyword => val === keyword)) {
          anchorRowIndex = ri;
          break;
        }
      }
      if (anchorRowIndex !== -1) break;
    }
  }

  // Phase 2: Search for header row starting from anchor (or row 0)
  const searchStartRow = anchorRowIndex !== -1 ? anchorRowIndex : 0;
  const searchEndRow = Math.min(searchStartRow + 10, rows.length);

  let headerRowIndex = -1;
  const columns: Record<string, number> = {};

  // Initialize all columns as not found (-1)
  for (const [key] of config.headerMappings) {
    columns[key] = -1;
  }

  // Determine required columns for header detection
  const requiredColumns = config.requiredColumns || (config.headerMappings.length > 0
    ? [config.headerMappings[0][0]]
    : []);

  // Search rows for headers
  for (let ri = searchStartRow; ri < searchEndRow; ri++) {
    const row = rows[ri]?.c || [];
    const rowVals = row.map(c => normalizeString(getCellValue(c)));

    // Try to map columns based on header mappings
    const tempColumns: Record<string, number> = {};
    const assignedCols = new Set<number>();

    // Process mappings in order (important for disambiguation)
    for (const [key, possibleHeaders] of config.headerMappings) {
      for (let ci = 0; ci < rowVals.length; ci++) {
        if (assignedCols.has(ci)) continue;

        const val = rowVals[ci];
        for (const header of possibleHeaders) {
          // Use exact match for single-word headers, includes for multi-word
          const isMatch = header.includes(' ')
            ? val.includes(header.toLowerCase())
            : val === header.toLowerCase();

          if (isMatch) {
            tempColumns[key] = ci;
            assignedCols.add(ci);
            break;
          }
        }
        if (tempColumns[key] !== undefined) break;
      }
    }

    // Check if we found enough required columns
    const foundRequired = requiredColumns.every(col => tempColumns[col] !== undefined);

    if (foundRequired) {
      headerRowIndex = ri;
      // Merge found columns
      for (const [key] of config.headerMappings) {
        columns[key] = tempColumns[key] ?? -1;
      }
      break;
    }
  }

  // Phase 3: Fallback - Try using table.cols if row-based detection failed
  if (headerRowIndex === -1 && cols.length > 0) {
    const assignedCols = new Set<number>();

    for (const [key, possibleHeaders] of config.headerMappings) {
      for (let ci = 0; ci < cols.length; ci++) {
        if (assignedCols.has(ci)) continue;

        const label = normalizeString(cols[ci].label || '');

        // First try exact match
        for (const header of possibleHeaders) {
          if (label === header.toLowerCase()) {
            columns[key] = ci;
            assignedCols.add(ci);
            break;
          }
        }

        // If not found and in Tables mode, try keyword search within label
        if (columns[key] === -1 && isTablesModeDetected(table)) {
          for (const header of possibleHeaders) {
            // Use word boundary regex for accurate matching
            const headerPattern = new RegExp(`\\b${header.replace(/\s+/g, '\\s+')}\\b`, 'i');
            if (headerPattern.test(label)) {
              columns[key] = ci;
              assignedCols.add(ci);
              break;
            }
          }
        }
      }
    }

    // In Tables mode, data starts at row 0 (no header row in rows array)
    if (isTablesModeDetected(table)) {
      headerRowIndex = -1; // Signal that there's no header row in the rows array
    }
  }

  // Check if we found the primary column(s)
  const hasPrimaryColumn = requiredColumns.some(col => columns[col] !== -1);

  if (!hasPrimaryColumn) {
    return null;
  }

  return { headerRowIndex, columns };
}

/**
 * Parse a GViz table into typed objects using a row mapper function
 *
 * @param table - The GViz table data
 * @param config - Table parsing configuration
 * @param rowMapper - Function to convert a row to the desired type (return null to skip)
 * @returns Array of parsed objects
 */
export function parseTable<T>(
  table: GvizTable,
  config: TableConfig,
  rowMapper: (row: GvizRow, columns: Record<string, number>, rowIndex: number) => T | null
): T[] {
  const results: T[] = [];

  // Find headers
  const headerResult = findTableHeaders(table, config);
  if (!headerResult) {
    return results;
  }

  const { headerRowIndex, columns } = headerResult;
  const rows = table.rows || [];

  // Determine data start row:
  // - If headerRowIndex is -1 (Tables mode), data starts at row 0
  // - Otherwise, data starts after the header row
  const dataStartRow = headerRowIndex === -1 ? 0 : headerRowIndex + 1;

  // Parse rows
  for (let ri = dataStartRow; ri < rows.length; ri++) {
    const row = rows[ri];
    if (!row || !row.c) continue;

    // Check if this row looks like another section header (stop parsing)
    const firstCellVal = normalizeString(getCellValue(row.c[0]));
    if (config.anchorKeywords && config.anchorKeywords.some(k =>
      firstCellVal === k.toLowerCase() && ri > dataStartRow
    )) {
      break;
    }

    // Map row to object
    const mapped = rowMapper(row, columns, ri);
    if (mapped !== null) {
      results.push(mapped);
    }
  }

  return results;
}

/**
 * Helper to get a cell value from a row by column key
 */
export function getColumnValue(
  row: GvizRow,
  columns: Record<string, number>,
  columnKey: string
): string {
  const colIndex = columns[columnKey];
  if (colIndex === -1 || colIndex === undefined) return '';

  const cells = row.c || [];
  if (colIndex >= cells.length) return '';

  return getCellValue(cells[colIndex]);
}

/**
 * Helper to get a cell from a row by column key
 */
export function getColumnCell(
  row: GvizRow,
  columns: Record<string, number>,
  columnKey: string
): GvizCell | null {
  const colIndex = columns[columnKey];
  if (colIndex === -1 || colIndex === undefined) return null;

  const cells = row.c || [];
  if (colIndex >= cells.length) return null;

  return cells[colIndex] || null;
}
