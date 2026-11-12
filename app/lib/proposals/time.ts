/** One way to show proposal times: date, time and a zone abbreviation. Pass timeZone only for the server's first render. */
export function formatProposalTime(iso: string, locale: string, timeZone?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', ...(timeZone ? { timeZone } : {}) }).format(d)
}
