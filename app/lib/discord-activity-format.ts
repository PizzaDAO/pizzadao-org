// Client-safe formatting for the Discord activity block (no database imports).

/** Message count for display: exact below 1,000, then compact ("12.4K") in the viewer's locale. */
export function formatMessageCount(n: number, locale?: string): { compact: boolean; text: string } {
  if (n < 1000) return { compact: false, text: String(n) }
  try {
    return { compact: true, text: new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n) }
  } catch {
    return { compact: true, text: `${Math.round(n / 100) / 10}K` }
  }
}
