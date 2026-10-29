/**
 * Speaker names for imported calls. A diarized speaker is `xs:N`; until a reviewer labels it, every reader
 * shows "Speaker N". Pure helpers; the database write is setSpeakerLabel in speakers.ts.
 */

const IMPORTED_SPEAKER = /^xs:(\d{1,3})$/

/** N of `xs:N`, or null for any other speaker id (a Discord id). `xs:0` (text no speaker explains) is null too. */
export function importedSpeakerNumber(speakerId: string): number | null {
  const m = IMPORTED_SPEAKER.exec(speakerId)
  const n = m ? Number(m[1]) : 0
  return n > 0 ? n : null
}

/**
 * The name to show for a speaker. A labelled speaker shows the label; an unlabelled imported speaker shows
 * "Speaker N" (`speakerN` is the translated template); anything else shows `fallback`.
 */
export function displaySpeakerName(speakerId: string, displayName: string | null | undefined, text: { speakerN: (n: number) => string; fallback: string }): string {
  const name = (displayName ?? '').trim()
  if (name) return name
  const n = importedSpeakerNumber(speakerId)
  return n !== null ? text.speakerN(n) : text.fallback
}

export const MAX_LABEL_CHARS = 40

/** One line, control and line-separator characters removed, at most 40 characters; empty means "no label". */
export function tidyLabel(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_CHARS)
}
