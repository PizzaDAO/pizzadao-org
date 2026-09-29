/**
 * Small string helpers shared by server and client code (no server-only imports).
 */

/** Stringify, trim, and collapse internal whitespace runs to a single space. */
export function norm(s: unknown): string {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}
