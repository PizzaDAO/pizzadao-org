// Pure text helpers for crew drafts. Client-safe.

export const X_LIMIT = 280
export const X_URL_LENGTH = 23

export const DRAFT_PLATFORMS = ['x', 'linkedin', 'discord', 'telegram'] as const
export type DraftPlatform = (typeof DRAFT_PLATFORMS)[number]
export const DRAFT_STATUSES = ['draft', 'ready', 'posted', 'archived'] as const
export type DraftStatus = (typeof DRAFT_STATUSES)[number]

const URL_RE = /https?:\/\/[^\s]+/gi

/** Weighted-ish length as X counts it: every URL is 23 chars; other chars by code point. */
export function xLength(text: string): number {
  let urls = 0
  const rest = text.replace(URL_RE, () => {
    urls++
    return ''
  })
  return Array.from(rest).length + urls * X_URL_LENGTH
}

export function xRemaining(text: string): number {
  return X_LIMIT - xLength(text)
}

export function xIntentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`
}

/**
 * LinkedIn has no text-prefill share URL for personal posts; the feed share box
 * accepts `shareActive=true&text=`, which works when logged in. Copy remains the fallback.
 */
export function linkedinShareUrl(text: string): string {
  return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`
}

/**
 * Split long text into a numbered thread, each part <= limit (X length, with the
 * " n/N" suffix counted). Splits on paragraph, then sentence, then word boundaries.
 * Text that already fits returns a single un-numbered part.
 */
export function splitThread(text: string, limit = X_LIMIT): string[] {
  const clean = text.trim()
  if (!clean) return []
  if (xLength(clean) <= limit) return [clean]

  const build = (reserve: number): string[] => {
    const max = limit - reserve
    const parts: string[] = []
    let cur = ''
    const push = () => {
      if (cur.trim()) parts.push(cur.trim())
      cur = ''
    }
    const append = (piece: string, sep: string) => {
      const next = cur ? cur + sep + piece : piece
      if (xLength(next) <= max) cur = next
      else {
        push()
        cur = piece
      }
    }
    for (const para of clean.split(/\n{2,}/)) {
      if (xLength(para) <= max) {
        append(para, '\n\n')
        continue
      }
      for (const sentence of para.split(/(?<=[.!?])\s+/)) {
        if (xLength(sentence) <= max) {
          append(sentence, ' ')
          continue
        }
        for (const word of sentence.split(/\s+/)) {
          // A single over-long token (rare): hard-cut it.
          let w = word
          while (xLength(w) > max) {
            const chars = Array.from(w)
            let n = max
            while (n > 1 && xLength(chars.slice(0, n).join('')) > max) n--
            append(chars.slice(0, n).join(''), ' ')
            push()
            w = chars.slice(n).join('')
          }
          if (w) append(w, ' ')
        }
      }
    }
    push()
    return parts
  }

  // Suffix " 10/10" is at most 6 chars for <100 parts; iterate until stable.
  let reserve = 4
  let parts = build(reserve)
  for (let i = 0; i < 3; i++) {
    const suffixLen = ` ${parts.length}/${parts.length}`.length
    if (suffixLen <= reserve) break
    reserve = suffixLen
    parts = build(reserve)
  }
  return parts.map((p, i) => `${p} ${i + 1}/${parts.length}`)
}

// ---- Status transitions -------------------------------------------------

const TRANSITIONS: Record<DraftStatus, readonly DraftStatus[]> = {
  draft: ['ready', 'archived'],
  ready: ['draft', 'posted', 'archived'],
  posted: ['archived'],
  archived: ['draft'], // restore
}

export function canTransition(from: DraftStatus, to: DraftStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

/** Transitions that only leads / Dread Pizza Roberts may make. */
export function isLeadOnlyTransition(from: DraftStatus, to: DraftStatus): boolean {
  return to === 'posted' || to === 'archived' || (from === 'archived' && to === 'draft')
}

export function isHttpsUrl(u: string): boolean {
  try {
    return new URL(u).protocol === 'https:'
  } catch {
    return false
  }
}
