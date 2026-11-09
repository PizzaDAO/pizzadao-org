/**
 * Share a member's PUBLIC profile link (/profile/<memberId>), never a dashboard link.
 * Web Share API first (mobile share sheet), clipboard as the fallback.
 */

export function publicProfilePath(memberId: string): string {
  return `/profile/${encodeURIComponent(memberId)}`
}

export function publicProfileUrl(memberId: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}${publicProfilePath(memberId)}`
}

/** "Vouch for me on PizzaDAO: <url>", the text that is copied when sharing is not available. */
export function composeShareText(text: string, url: string): string {
  return `${text} ${url}`.trim()
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

export async function shareOrCopy(opts: { text: string; url: string; title?: string }): Promise<ShareResult> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: opts.title, text: opts.text, url: opts.url })
      return 'shared'
    } catch (err) {
      // The member closed the share sheet: do not also copy behind their back.
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled'
      // Any other failure: fall back to copying.
    }
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(composeShareText(opts.text, opts.url))
      return 'copied'
    }
  } catch {
    // clipboard may be blocked
  }
  return 'failed'
}
