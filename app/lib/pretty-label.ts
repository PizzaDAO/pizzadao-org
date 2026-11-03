/** Turn a raw value such as "content_creation" into "Content creation" for display. */
export function prettyLabel(raw: string | null | undefined, fallback = "General"): string {
  const s = (raw ?? "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return fallback;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
