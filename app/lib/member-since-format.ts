// Client-safe formatting for the "member since" date (no database imports).

/** Month and year in the viewer's locale ("March 2021"); "" when the date is missing or invalid. */
export function formatMemberSince(iso: string | null | undefined, locale?: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  try {
    return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(d)
  } catch {
    return d.toISOString().slice(0, 7)
  }
}
