/**
 * Spoken "play us out" command for Metalhead ("That's the end of the call, Metalhead, play the song").
 *
 * Pure matcher; the app side of the recorder's fast path is play-out-run.ts. The recorder sends each
 * short speech burst of an allowed speaker; a burst that gives the command answers `playOut: true`
 * and the recorder asks pizza-radio for the crew song.
 *
 * Imperative only. Accepted: the name directly followed by "play <the song | us out | ...>" (optionally
 * after "please", "can you", "could you", "go ahead and"), or that request directly followed by the
 * name ("play the song, Metalhead"). Anything that merely talks about the command is rejected: a
 * question or auxiliary before the name or between the name and "play" ("did Metalhead play...",
 * "Metalhead is going to play...", "you just say Metalhead play..."), future or hypothetical words,
 * and long bursts. The name tolerates transcription errors ("metal head", "medalhead"). A missed
 * command costs a repeat; a false one plays a song over a live call.
 */

const NAME = 'metalhead'
/** Longest burst (in words) that can be a command; a long ramble that mentions Metalhead is not one. */
export const MAX_COMMAND_WORDS = 24
/** Words anywhere in the burst that make it hypothetical, negated or about the future. */
const HEDGES = new Set([
  'not', 'dont', 'never', 'later', 'tomorrow', 'tonight', 'next', 'if', 'once', 'stop', 'wont', 'instead', 'maybe', 'whether', 'unless', 'yesterday', 'last', 'will', 'should', 'ask', 'asked', 'asking', 'tell', 'told', 'wants', 'want', 'wanted',
])
/** In the clause just before the command, these mean someone is talking about it, not giving it. */
const TALK_BEFORE = new Set([
  'is', 'are', 'was', 'were', 'be', 'going', 'gonna', 'would', 'will', 'did', 'does', 'do', 'why', 'say', 'says', 'said', 'saying', 'just', 'can', 'could', 'when', 'if', 'how', 'what', 'whether', 'let', 'lets',
])
const OBJECTS = new Set(['song', 'songs', 'music', 'tune', 'outro', 'theme', 'jingle', 'track', 'anthem'])
/** How many words before the command are looked at for talk-about words. */
const LOOKBEHIND = 3

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

const clean = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

/** Lower-case words, punctuation and apostrophes dropped ("don't" -> "dont"). */
export function commandWords(text: string): string[] {
  return clean(text)
}

/** Words with the clause (split at . , ; : ! ?) each belongs to. */
function clauses(text: string): { words: string[]; clause: number[] } {
  const words: string[] = []
  const clause: number[] = []
  text.split(/[.,;:!?]+/).forEach((part, ci) => {
    for (const w of clean(part)) {
      words.push(w)
      clause.push(ci)
    }
  })
  return { words, clause }
}

/** Index where the name starts and ends, as one word or two ("metal head"), tolerating a couple of mis-hearings. */
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

/** "play" at `at`, followed within a few words by a song-like object or "us out": the index of the request's last word, else -1. */
function playRequestEnd(words: string[], at: number): number {
  if (words[at] !== 'play') return -1
  if (words[at + 1] === 'us' && words[at + 2] === 'out') return at + 2
  for (let k = 1; k <= 4; k++) if (OBJECTS.has(words[at + k] ?? '')) return at + k
  return -1
}

/** Skips "please", "can you", "could you", "go ahead and" in front of "play". */
function skipPolite(words: string[], from: number): number {
  let j = from
  for (;;) {
    if (words[j] === 'please') j += 1
    else if ((words[j] === 'can' || words[j] === 'could') && words[j + 1] === 'you') j += 2
    else if (words[j] === 'go' && words[j + 1] === 'ahead' && words[j + 2] === 'and') j += 3
    else return j
  }
}

/** True when the utterance tells Metalhead to play the call's closing song. */
export function isPlayOutCommand(text: string): boolean {
  const { words, clause } = clauses(text)
  if (words.length < 3 || words.length > MAX_COMMAND_WORDS) return false
  if (words.some((w) => HEDGES.has(w))) return false
  // Words of the same clause just before `i` that show the speaker is talking about the command.
  const talksBefore = (i: number) => {
    for (let k = Math.max(0, i - LOOKBEHIND); k < i; k++) if (clause[k] === clause[i] && TALK_BEFORE.has(words[k])) return true
    return false
  }
  for (const n of nameAt(words)) {
    // "<name> [polite] play the song": nothing but the polite list between name and play.
    const p = skipPolite(words, n.end + 1)
    if (playRequestEnd(words, p) >= 0 && !talksBefore(n.index)) return true
    // "play the song [please], <name>": the request ends right where the name begins.
    for (let a = Math.max(0, n.index - 7); a < n.index; a++) {
      const end = playRequestEnd(words, a)
      if (end < 0) continue
      let after = end + 1
      if (words[after] === 'please') after += 1
      if (after === n.index && !talksBefore(a)) return true
    }
  }
  return false
}
