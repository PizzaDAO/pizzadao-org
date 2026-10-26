// Pure text helpers for crew drafts. Client-safe.
import twitterText from 'twitter-text'

const { parseTweet } = twitterText

export const X_LIMIT = 280
export const X_URL_LENGTH = 23

export const DRAFT_PLATFORMS = ['x', 'linkedin', 'discord', 'telegram'] as const
export type DraftPlatform = (typeof DRAFT_PLATFORMS)[number]
export const DRAFT_STATUSES = ['draft', 'ready', 'posted', 'archived'] as const
export type DraftStatus = (typeof DRAFT_STATUSES)[number]

/**
 * Length as X counts it (twitter-text parseTweet): URLs and bare domains are 23,
 * emoji and CJK/wide characters are 2, trailing punctuation is not part of a URL.
 */
export function xLength(text: string): number {
  return parseTweet(text).weightedLength
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
 * Split long text into a numbered thread, each part <= limit by X's count (the
 * " n/N" suffix included). Splits on paragraph, then line, then sentence, then
 * word boundaries; paragraph breaks and line breaks inside a part are kept.
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
    // Add a piece to the current part joined by `sep`; start a new part if it won't fit.
    const append = (piece: string, sep: string) => {
      const next = cur ? cur + sep + piece : piece
      if (xLength(next) <= max) cur = next
      else {
        push()
        cur = piece
      }
    }
    const words = (sentence: string, sep: string) => {
      let first = true
      for (const word of sentence.split(/ +/)) {
        let w = word
        // A single over-long token (rare): hard-cut it.
        while (xLength(w) > max) {
          const chars = Array.from(w)
          let n = chars.length - 1
          while (n > 1 && xLength(chars.slice(0, n).join('')) > max) n--
          append(chars.slice(0, n).join(''), first ? sep : ' ')
          first = false
          push()
          w = chars.slice(n).join('')
        }
        if (w) {
          append(w, first ? sep : ' ')
          first = false
        }
      }
    }
    for (const para of clean.split(/\n{2,}/)) {
      if (xLength(para) <= max) {
        append(para, '\n\n')
        continue
      }
      let firstLine = true
      for (const line of para.split('\n')) {
        const lineSep = firstLine ? '\n\n' : '\n'
        firstLine = false
        if (xLength(line) <= max) {
          append(line, lineSep)
          continue
        }
        let firstSentence = true
        for (const sentence of line.split(/(?<=[.!?]) +/)) {
          const sep = firstSentence ? lineSep : ' '
          firstSentence = false
          if (xLength(sentence) <= max) append(sentence, sep)
          else words(sentence, sep)
        }
      }
    }
    push()
    return parts
  }

  // Reserve room for the " n/N" suffix; iterate until the part count is stable.
  let reserve = 4
  let parts = build(reserve)
  for (let i = 0; i < 4; i++) {
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

export { isHttpsUrl } from './draft-limits.mjs'
