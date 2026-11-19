/** Capo image review: vote validation, set loading, tallies and the export. */
import { prisma } from '@/app/lib/db'
import { memberNamesByDiscordId } from '@/app/lib/member-names'

export const MAX_COMMENT = 500
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

export type VoteValue = 'YES' | 'NO'
export type ParsedVote = { candidateId: string; vote: VoteValue; comment: string | null }

/** Validates a POSTed vote body. Returns the parsed vote or an error message. */
export function parseVote(body: unknown): { ok: true; value: ParsedVote } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>
  if (typeof b.candidateId !== 'string' || !b.candidateId || b.candidateId.length > 64) return { ok: false, error: 'candidateId is required' }
  if (b.vote !== 'YES' && b.vote !== 'NO') return { ok: false, error: 'vote must be YES or NO' }
  let comment: string | null = null
  if (b.comment !== undefined && b.comment !== null) {
    if (typeof b.comment !== 'string') return { ok: false, error: 'comment must be text' }
    const c = b.comment.trim()
    if (c.length > MAX_COMMENT) return { ok: false, error: `comment must be ${MAX_COMMENT} characters or fewer` }
    comment = c || null
  }
  return { ok: true, value: { candidateId: b.candidateId, vote: b.vote, comment } }
}

type CandidateRow = {
  id: string
  imageUrl: string
  prompt: string
  traits: unknown
  position: number
  votes: Array<{ discordId: string; vote: VoteValue; comment: string | null; updatedAt: Date }>
}

export type CandidateView = {
  id: string
  imageUrl: string
  traits: Record<string, string>
  position: number
  yes: number
  no: number
  mine: { vote: VoteValue; comment: string | null } | null
  comments: Array<{ name: string; vote: VoteValue; comment: string; mine: boolean }>
}

/** Pure shaping of candidate rows for one viewer. */
export function buildCandidateViews(rows: CandidateRow[], viewerId: string, names: Map<string, { name: string }>): CandidateView[] {
  return rows.map((r) => {
    const mine = r.votes.find((v) => v.discordId === viewerId)
    return {
      id: r.id,
      imageUrl: r.imageUrl,
      traits: (r.traits && typeof r.traits === 'object' ? r.traits : {}) as Record<string, string>,
      position: r.position,
      yes: r.votes.filter((v) => v.vote === 'YES').length,
      no: r.votes.filter((v) => v.vote === 'NO').length,
      mine: mine ? { vote: mine.vote, comment: mine.comment } : null,
      comments: r.votes
        .filter((v) => v.comment)
        .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
        .map((v) => ({ name: names.get(v.discordId)?.name ?? 'A capo', vote: v.vote, comment: v.comment as string, mine: v.discordId === viewerId })),
    }
  })
}

export async function loadSet(slug: string, viewerId: string) {
  const set = await prisma.imageReviewSet.findUnique({
    where: { slug },
    include: { candidates: { orderBy: { position: 'asc' }, include: { votes: true } } },
  })
  if (!set) return null
  const rows = set.candidates as unknown as CandidateRow[]
  const names = await memberNamesByDiscordId(rows.flatMap((c) => c.votes.map((v) => v.discordId)))
  return { slug: set.slug, title: set.title, description: set.description, candidates: buildCandidateViews(rows, viewerId, names) }
}

/** Upsert: one changeable vote per capo per image. Returns false when the candidate is not in the set. */
export async function castVote(slug: string, discordId: string, v: ParsedVote): Promise<boolean> {
  const cand = await prisma.imageReviewCandidate.findFirst({ where: { id: v.candidateId, set: { slug } }, select: { id: true } })
  if (!cand) return false
  await prisma.imageReviewVote.upsert({
    where: { candidateId_discordId: { candidateId: v.candidateId, discordId } },
    create: { candidateId: v.candidateId, discordId, vote: v.vote, comment: v.comment },
    update: { vote: v.vote, comment: v.comment },
  })
  return true
}

export type ExportRow = {
  position: number
  imageUrl: string
  prompt: string
  traits: Record<string, string>
  yes: number
  no: number
  comments: string[]
}

export async function loadExport(slug: string): Promise<ExportRow[] | null> {
  const set = await prisma.imageReviewSet.findUnique({
    where: { slug },
    include: { candidates: { orderBy: { position: 'asc' }, include: { votes: true } } },
  })
  if (!set) return null
  const rows = set.candidates as unknown as CandidateRow[]
  const names = await memberNamesByDiscordId(rows.flatMap((c) => c.votes.map((v) => v.discordId)))
  return rows.map((r) => ({
    position: r.position,
    imageUrl: r.imageUrl,
    prompt: r.prompt,
    traits: (r.traits && typeof r.traits === 'object' ? r.traits : {}) as Record<string, string>,
    yes: r.votes.filter((v) => v.vote === 'YES').length,
    no: r.votes.filter((v) => v.vote === 'NO').length,
    comments: r.votes.filter((v) => v.comment).map((v) => `${names.get(v.discordId)?.name ?? 'A capo'} (${v.vote}): ${v.comment}`),
  }))
}

function csvCell(s: string): string {
  // Neutralize spreadsheet formulas, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return `"${safe.replace(/"/g, '""')}"`
}

export function exportCsv(rows: ExportRow[]): string {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.traits)))].sort()
  const head = ['position', 'imageUrl', ...keys, 'yes', 'no', 'prompt', 'comments']
  const lines = rows.map((r) =>
    [String(r.position), r.imageUrl, ...keys.map((k) => r.traits[k] ?? ''), String(r.yes), String(r.no), r.prompt, r.comments.join(' | ')].map(csvCell).join(','),
  )
  return [head.map(csvCell).join(','), ...lines].join('\n') + '\n'
}
