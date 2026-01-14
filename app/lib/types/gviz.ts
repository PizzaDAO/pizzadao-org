/**
 * Type definitions for Google Visualization (GViz) API responses
 * Used throughout the codebase for parsing Google Sheets data
 */

export interface GvizCell {
  v?: string | number | boolean | null;
  f?: string; // formatted value / formula
  l?: string; // hyperlink
}

export interface GvizRow {
  c?: GvizCell[];
}

export interface GvizColumn {
  label?: string;
  type?: string;
}

export interface GvizTable {
  cols?: GvizColumn[];
  rows?: GvizRow[];
}

export interface GvizResponse {
  table?: GvizTable;
  version?: string;
  status?: string;
}
