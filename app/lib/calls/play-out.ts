/**
 * Spoken "play us out" command for Metalhead ("That's the end of the call, Metalhead, play the song").
 *
 * Pure matcher plus the app side of the recorder's fast path (play-out-run.ts). The recorder sends
 * each short speech burst of an eligible call here; a burst that addresses Metalhead with a play-out
 * request answers `playOut: true` and the recorder asks pizza-radio for the crew song.
 *
 * The matcher is deliberately strict about phrasing (an imperative "play ..." aimed at Metalhead, in a
 * short burst, with no hedging words) and tolerant of transcription errors in the name ("metal head",
 * "medalhead"). A missed command costs a repeat; a false one plays a song over a live call.
 */

const NAME = 'metalhead'
/** Longest burst (in words) that can be a command; a long ramble that mentions Metalhead is not one. */
export const MAX_COMMAND_WORDS = 24
/** The name and the verb must be this close (in words). */
const NAME_VERB_WINDOW = 8
/** Words that make a mention hypothetical, negated or about the future. */
const HEDGES = new Set([
  'not', 'dont', 'never', 'later', 'tomorrow', 'tonight', 'next', 'if', 'once', 'stop', 'wont', 'instead', 'maybe', 'whether', 'unless', 'yesterday', 'last', 'will', 'should', 'ask', 'asked', 'asking', 'tell', 'told', 'wants', 'want', 'wanted',
])
const OBJECTS = new Set(['song', 'songs', 'music', 'tune', 'outro', 'theme', 'jingle', 'track', 'anthem'])

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

/** Lower-case words, punctuation and apostrophes dropped ("don't" -> "dont"). */
export function commandWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Indices where the name starts, as one word or two ("metal head"), tolerating a couple of mis-hearings. */
function nameAt(words: string[]): Array<{ index: number; end: number }> {
  const hits: Array<{ index: number; end: number }> = []
  for (let i = 0; i < words.length; i++) {
    if (words[i].length >= 7 && levenshtein(words[i], NAME, 2) <= 2) hits.push({ index: i, end: i })
    else if (i + 1 < words.length && words[i].length >= 3 && words[i + 1].length >= 2) {
      const joined = words[i] + words[i + 1]
      if (joined.length >= 7 && levenshtein(joined, NAME, 2) <= 2) hits.push({ index: i, end: i + 1 })
    }
  }
  return hits
}

/** "play" followed within a few words by a song-like object, or "play us out". Returns the verb index or -1. */
function playRequestAt(words: string[], from: number, to: number): number {
  for (let i = Math.max(0, from); i <= Math.min(words.length - 1, to); i++) {
    if (words[i] !== 'play') continue
    if (words[i + 1] === 'us' && words[i + 2] === 'out') return i
    for (let k = 1; k <= 4; k++) if (OBJECTS.has(words[i + k] ?? '')) return i
  }
  return -1
}

/** True when the utterance tells Metalhead to play the call's closing song. */
export function isPlayOutCommand(text: string): boolean {
  const words = commandWords(text)
  if (words.length < 3 || words.length > MAX_COMMAND_WORDS) return false
  if (words.some((w) => HEDGES.has(w))) return false
  for (const n of nameAt(words)) {
    // Name first ("Metalhead, play the song") or after ("play the song, Metalhead").
    if (playRequestAt(words, n.end + 1, n.end + NAME_VERB_WINDOW) >= 0) return true
    if (playRequestAt(words, n.index - NAME_VERB_WINDOW, n.index - 1) >= 0) return true
  }
  return false
}
