/**
 * People resolver (pure). Turns "who the follow-up is for" into a Discord id:
 *   1. a speaker on the call (their Discord id is known),
 *   2. an exact case/diacritic-folded match on the member sheet's names,
 *   3. a close match (small edit distance, or all the words of one name inside the other).
 * Ties are never guessed: they come back as `ambiguous` with the candidates so a reviewer picks.
 */

export interface MemberRef {
  id: string
  name: string
  discordId: string
}

export interface Candidate {
  memberId: string
  name: string
  discordId: string
}

export interface Resolution {
  status: 'resolved' | 'ambiguous' | 'unresolved'
  discordId: string | null
  memberId: string | null
  matchedBy: 'speaker' | 'exact' | 'fuzzy' | null
  candidates: Candidate[]
}

export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

function threshold(len: number): number {
  return len <= 5 ? 1 : len <= 10 ? 2 : 3
}

const toCandidate = (m: MemberRef): Candidate => ({ memberId: m.id, name: m.name, discordId: m.discordId })

function tokenSubset(a: string, b: string): boolean {
  const ta = a.split(' ').filter((t) => t.length >= 3)
  const tb = new Set(b.split(' '))
  return ta.length >= 2 && ta.every((t) => tb.has(t))
}

const MAX_CANDIDATES = 5

export function resolveOwner(input: { ownerName: string; speakerDiscordId?: string | null }, members: readonly MemberRef[]): Resolution {
  const none: Resolution = { status: 'unresolved', discordId: null, memberId: null, matchedBy: null, candidates: [] }
  if (input.speakerDiscordId) {
    const m = members.find((x) => x.discordId === input.speakerDiscordId)
    return { status: 'resolved', discordId: input.speakerDiscordId, memberId: m?.id ?? null, matchedBy: 'speaker', candidates: [] }
  }
  const q = normalizeName(input.ownerName)
  if (!q) return none
  const named = members.map((m) => ({ m, n: normalizeName(m.name) })).filter((x) => x.n)

  const exact = named.filter((x) => x.n === q)
  if (exact.length === 1) return { status: 'resolved', discordId: exact[0].m.discordId || null, memberId: exact[0].m.id, matchedBy: 'exact', candidates: [] }
  if (exact.length > 1) return { ...none, status: 'ambiguous', candidates: exact.slice(0, MAX_CANDIDATES).map((x) => toCandidate(x.m)) }

  const limit = threshold(q.length)
  const scored = named
    .map((x) => {
      let d = editDistance(q, x.n)
      if (d > limit && (tokenSubset(q, x.n) || tokenSubset(x.n, q))) d = limit // all words present
      return { m: x.m, d }
    })
    .filter((x) => x.d <= limit)
    .sort((a, b) => a.d - b.d)
  if (scored.length === 0) return none
  const best = scored.filter((x) => x.d === scored[0].d)
  if (best.length === 1) return { status: 'resolved', discordId: best[0].m.discordId || null, memberId: best[0].m.id, matchedBy: 'fuzzy', candidates: [] }
  return { ...none, status: 'ambiguous', candidates: best.slice(0, MAX_CANDIDATES).map((x) => toCandidate(x.m)) }
}

export type Channel = 'DISCORD' | 'TELEGRAM'
