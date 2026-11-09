/**
 * Live Q&A and polls of a live call (Slido-style). Tied to the recorder session id and kept after the
 * call (the published call page shows them, gated like action items).
 *
 * Privacy rules enforced here, in one place:
 *  - an anonymous asker's id and name only ever go to hosts, and never with a profile link;
 *  - hidden (moderated) questions and draft polls reach hosts only;
 *  - poll counts reach members only once the host allows it (showResults) or the poll is closed;
 *  - question and poll text with a blocked term (the private post filter) is never shown, and when the
 *    filter cannot be read nothing is shown (fail closed).
 *
 * Cost: the session-wide part of the view (questions with vote counts, polls with counts, profile ids)
 * is built once per ~3 s per instance and shared by every viewer; a viewer only costs their own votes.
 */
import { z } from 'zod'
import { prisma } from '@/app/lib/db'
import { checkKeyedRateLimit } from '@/app/lib/rate-limit'
import type { Settings } from '@/app/lib/settings'
import { personRef, resolveMemberIds, type PersonRef } from './live-members'
import { loadPostFilter, mentionsBlockedTerm, type PostFilter } from './post-filters'
import { normalizeStreamLink } from './live-state'

export const MAX_QUESTION_CHARS = 280
export const MIN_QUESTION_CHARS = 3
export const MAX_POLL_QUESTION_CHARS = 200
export const MAX_POLL_OPTION_CHARS = 80
export const MIN_POLL_OPTIONS = 2
export const MAX_POLL_OPTIONS = 6
const MAX_QUESTIONS_SHOWN = 150
/** The session-wide view is rebuilt at most this often per instance. */
export const SHARED_VIEW_TTL_MS = 3_000

export class LiveQaError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code)
  }
}

export function cleanLine(v: string, max: number): string {
  return v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

// ---- actions ---------------------------------------------------------------------------------

const sid = z.string().min(1).max(120)

/** Every action names the live call it is for; a different or ended call is rejected. */
export const actionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('ask'), sessionId: sid, text: z.string().max(2000), anonymous: z.boolean().optional() }),
  z.object({ op: z.literal('vote'), sessionId: sid, questionId: z.string().min(1).max(60) }),
  z.object({
    op: z.literal('moderate'),
    sessionId: sid,
    questionId: z.string().min(1).max(60),
    action: z.enum(['answer', 'unanswer', 'pin', 'unpin', 'hide', 'unhide']),
  }),
  z.object({
    op: z.literal('createPoll'),
    sessionId: sid,
    question: z.string().max(1000),
    options: z.array(z.string().max(500)).min(MIN_POLL_OPTIONS).max(MAX_POLL_OPTIONS),
    showResults: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('pollAction'),
    sessionId: sid,
    pollId: z.string().min(1).max(60),
    action: z.enum(['open', 'close', 'showResults', 'hideResults']),
  }),
  z.object({ op: z.literal('pollVote'), sessionId: sid, pollId: z.string().min(1).max(60), option: z.number().int().min(0).max(MAX_POLL_OPTIONS - 1) }),
  z.object({ op: z.literal('setStreamLink'), sessionId: sid, link: z.string().max(500).nullable() }),
])
export type LiveAction = z.infer<typeof actionSchema>

export interface Actor {
  discordId: string
  name: string | null
  host: boolean
}

interface Ctx {
  sessionId: string
  actor: Actor
  settings: Settings
  now?: number
}

type Tx = Pick<typeof prisma, 'callLiveQuestion' | 'callLivePoll' | 'callLivePollVote' | '$executeRaw'>

const lock = (tx: Tx, key: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`

/** One question at a time per member and call: the counts and the insert happen under a lock. */
export async function askQuestion(ctx: Ctx, input: { text: string; anonymous?: boolean }): Promise<{ id: string }> {
  const now = ctx.now ?? Date.now()
  const text = cleanLine(input.text, 2000)
  if (text.length < MIN_QUESTION_CHARS) throw new LiveQaError(400, 'too-short')
  if (text.length > MAX_QUESTION_CHARS) throw new LiveQaError(400, 'too-long')
  const max = ctx.settings.get('calls.liveQuestionMaxPerMember')
  const gapMs = ctx.settings.get('calls.liveQuestionMinGapSeconds') * 1000
  const mine = { sessionId: ctx.sessionId, authorId: ctx.actor.discordId }
  return prisma.$transaction(async (tx) => {
    await lock(tx as unknown as Tx, `live-ask:${ctx.sessionId}:${ctx.actor.discordId}`)
    if ((await tx.callLiveQuestion.count({ where: mine })) >= max) throw new LiveQaError(429, 'limit')
    if (gapMs > 0) {
      const last = await tx.callLiveQuestion.findFirst({ where: mine, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
      if (last && now - last.createdAt.getTime() < gapMs) throw new LiveQaError(429, 'too-fast')
    }
    const row = await tx.callLiveQuestion.create({
      data: { ...mine, authorName: ctx.actor.name ? cleanLine(ctx.actor.name, 100) : null, text, anonymous: input.anonymous === true },
      select: { id: true },
    })
    return { id: row.id }
  })
}

async function allowVote(actor: Actor): Promise<void> {
  const rl = await checkKeyedRateLimit('live-vote', actor.discordId)
  if (!rl.success) throw new LiveQaError(429, 'too-fast')
}

export async function toggleQuestionVote(ctx: Ctx, questionId: string): Promise<{ voted: boolean }> {
  await allowVote(ctx.actor)
  const q = await prisma.callLiveQuestion.findFirst({ where: { id: questionId, sessionId: ctx.sessionId }, select: { id: true, hidden: true } })
  if (!q || (q.hidden && !ctx.actor.host)) throw new LiveQaError(404, 'not-found')
  const key = { questionId, voterId: ctx.actor.discordId }
  const had = await prisma.callLiveQuestionVote.findUnique({ where: { questionId_voterId: key } })
  if (had) {
    await prisma.callLiveQuestionVote.deleteMany({ where: key })
    return { voted: false }
  }
  try {
    await prisma.callLiveQuestionVote.create({ data: key })
  } catch (err) {
    // A double tap raced: the composite key keeps it to one vote.
    if ((err as { code?: string } | null)?.code !== 'P2002') throw err
  }
  return { voted: true }
}

export async function moderateQuestion(ctx: Ctx, questionId: string, action: 'answer' | 'unanswer' | 'pin' | 'unpin' | 'hide' | 'unhide'): Promise<void> {
  if (!ctx.actor.host) throw new LiveQaError(403, 'forbidden')
  const q = await prisma.callLiveQuestion.findFirst({ where: { id: questionId, sessionId: ctx.sessionId }, select: { id: true } })
  if (!q) throw new LiveQaError(404, 'not-found')
  const now = new Date(ctx.now ?? Date.now())
  if (action === 'answer') await prisma.callLiveQuestion.update({ where: { id: questionId }, data: { answered: true, answeredAt: now, pinned: false } })
  else if (action === 'unanswer') await prisma.callLiveQuestion.update({ where: { id: questionId }, data: { answered: false, answeredAt: null } })
  else if (action === 'pin') {
    // One highlighted question at a time: unpin the others and pin this one together.
    await prisma.$transaction(async (tx) => {
      await lock(tx as unknown as Tx, `live-pin:${ctx.sessionId}`)
      await tx.callLiveQuestion.updateMany({ where: { sessionId: ctx.sessionId, pinned: true }, data: { pinned: false } })
      await tx.callLiveQuestion.update({ where: { id: questionId }, data: { pinned: true } })
    })
  } else if (action === 'unpin') await prisma.callLiveQuestion.update({ where: { id: questionId }, data: { pinned: false } })
  else if (action === 'hide') await prisma.callLiveQuestion.update({ where: { id: questionId }, data: { hidden: true, pinned: false } })
  else await prisma.callLiveQuestion.update({ where: { id: questionId }, data: { hidden: false } })
}

export async function createPoll(ctx: Ctx, input: { question: string; options: string[]; showResults?: boolean }): Promise<{ id: string }> {
  if (!ctx.actor.host) throw new LiveQaError(403, 'forbidden')
  const question = cleanLine(input.question, MAX_POLL_QUESTION_CHARS)
  const options = input.options.map((o) => cleanLine(o, MAX_POLL_OPTION_CHARS)).filter(Boolean)
  if (question.length < 3 || options.length < MIN_POLL_OPTIONS || options.length > MAX_POLL_OPTIONS) throw new LiveQaError(400, 'invalid-poll')
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw new LiveQaError(400, 'invalid-poll')
  const row = await prisma.callLivePoll.create({
    data: { sessionId: ctx.sessionId, question, options, status: 'draft', showResults: input.showResults === true, createdBy: ctx.actor.discordId, createdByName: ctx.actor.name ? cleanLine(ctx.actor.name, 100) : null },
    select: { id: true },
  })
  return { id: row.id }
}

/** Open / close run under the poll's lock (the same one votes take), so a vote cannot slip in after a close. */
export async function pollAction(ctx: Ctx, pollId: string, action: 'open' | 'close' | 'showResults' | 'hideResults'): Promise<void> {
  if (!ctx.actor.host) throw new LiveQaError(403, 'forbidden')
  const now = new Date(ctx.now ?? Date.now())
  await prisma.$transaction(async (tx) => {
    // Session lock first (one open poll at a time), then the poll's own lock (votes).
    if (action === 'open') await lock(tx as unknown as Tx, `live-poll-session:${ctx.sessionId}`)
    await lock(tx as unknown as Tx, `live-poll:${pollId}`)
    const poll = await tx.callLivePoll.findFirst({ where: { id: pollId, sessionId: ctx.sessionId }, select: { id: true, status: true } })
    if (!poll) throw new LiveQaError(404, 'not-found')
    if (action === 'open') {
      if (poll.status !== 'draft') throw new LiveQaError(409, 'not-draft')
      if ((await tx.callLivePoll.count({ where: { sessionId: ctx.sessionId, status: 'open' } })) > 0) throw new LiveQaError(409, 'another-open')
      await tx.callLivePoll.update({ where: { id: pollId }, data: { status: 'open', openedAt: now } })
    } else if (action === 'close') {
      if (poll.status !== 'open') throw new LiveQaError(409, 'not-open')
      await tx.callLivePoll.update({ where: { id: pollId }, data: { status: 'closed', closedAt: now } })
    } else {
      await tx.callLivePoll.update({ where: { id: pollId }, data: { showResults: action === 'showResults' } })
    }
  })
}

export async function votePoll(ctx: Ctx, pollId: string, option: number): Promise<void> {
  await allowVote(ctx.actor)
  await prisma.$transaction(async (tx) => {
    await lock(tx as unknown as Tx, `live-poll:${pollId}`)
    const poll = await tx.callLivePoll.findFirst({ where: { id: pollId, sessionId: ctx.sessionId }, select: { status: true, options: true } })
    if (!poll || poll.status === 'draft') throw new LiveQaError(404, 'not-found')
    if (poll.status !== 'open') throw new LiveQaError(409, 'closed')
    const count = Array.isArray(poll.options) ? poll.options.length : 0
    if (option < 0 || option >= count) throw new LiveQaError(400, 'bad-option')
    // One vote per member (composite key); voting again changes it while the poll is open.
    await tx.callLivePollVote.upsert({
      where: { pollId_voterId: { pollId, voterId: ctx.actor.discordId } },
      create: { pollId, voterId: ctx.actor.discordId, optionIndex: option },
      update: { optionIndex: option },
    })
  })
}

/** A host sets (or clears, with null) the stream link shown for this live call. */
export async function setStreamLink(ctx: Ctx, link: string | null): Promise<{ streamLink: string | null }> {
  if (!ctx.actor.host) throw new LiveQaError(403, 'forbidden')
  const clean = link && link.trim() ? normalizeStreamLink(link) : null
  if (link && link.trim() && !clean) throw new LiveQaError(400, 'invalid-link')
  await prisma.callLiveSession.update({ where: { sessionId: ctx.sessionId }, data: { streamLinkOverride: clean } })
  return { streamLink: clean }
}

export async function runLiveAction(ctx: Ctx, action: LiveAction): Promise<Record<string, unknown>> {
  // The action names its call; anything but the call it was checked against is refused.
  if (action.sessionId !== ctx.sessionId) throw new LiveQaError(409, 'not-live')
  try {
    switch (action.op) {
      case 'ask':
        return await askQuestion(ctx, action)
      case 'vote':
        return await toggleQuestionVote(ctx, action.questionId)
      case 'moderate':
        await moderateQuestion(ctx, action.questionId, action.action)
        return {}
      case 'createPoll':
        return await createPoll(ctx, action)
      case 'pollAction':
        await pollAction(ctx, action.pollId, action.action)
        return {}
      case 'pollVote':
        await votePoll(ctx, action.pollId, action.option)
        return {}
      case 'setStreamLink':
        return await setStreamLink(ctx, action.link)
    }
  } finally {
    // The next poll shows the change right away on this instance.
    clearQaCache(ctx.sessionId)
  }
}

// ---- views -----------------------------------------------------------------------------------

export interface QuestionView {
  id: string
  text: string
  votes: number
  voted: boolean
  mine: boolean
  answered: boolean
  pinned: boolean
  createdAt: string
  /** Host only. */
  hidden?: boolean
  /** True for an anonymous question; the name is then present for hosts only and never linked. */
  anonymous: boolean
  author: PersonRef | null
}

export interface PollView {
  id: string
  question: string
  status: string
  /** Host only: whether members may see counts before the poll closes. */
  showResults?: boolean
  options: Array<{ text: string; votes: number | null; percent: number | null }>
  total: number | null
  myVote: number | null
  createdBy: PersonRef | null
}

const asOptions = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

interface SharedQuestion {
  id: string
  text: string
  authorId: string
  authorName: string | null
  anonymous: boolean
  answered: boolean
  pinned: boolean
  hidden: boolean
  createdAt: Date
  votes: number
}
interface SharedPoll {
  id: string
  question: string
  status: string
  showResults: boolean
  options: string[]
  counts: number[]
  total: number
  createdBy: string
  createdByName: string | null
}
interface QaShared {
  questions: SharedQuestion[]
  polls: SharedPoll[]
  members: Map<string, string>
}

const shared = new Map<string, { at: number; value: Promise<QaShared> }>()
export function clearQaCache(sessionId?: string): void {
  if (sessionId) shared.delete(sessionId)
  else shared.clear()
}

async function buildShared(sessionId: string, filter: PostFilter): Promise<QaShared> {
  const [qs, polls] = await Promise.all([
    prisma.callLiveQuestion.findMany({ where: { sessionId }, orderBy: { createdAt: 'desc' }, take: MAX_QUESTIONS_SHOWN, include: { _count: { select: { votes: true } } } }),
    prisma.callLivePoll.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' }, take: 20, include: { votes: { select: { optionIndex: true } } } }),
  ])
  // A blocked term anywhere in what would be shown drops the whole question or poll.
  const questions: SharedQuestion[] = qs
    .filter((q) => !mentionsBlockedTerm(q.text, filter))
    .map((q) => ({ id: q.id, text: q.text, authorId: q.authorId, authorName: q.authorName, anonymous: q.anonymous, answered: q.answered, pinned: q.pinned, hidden: q.hidden, createdAt: q.createdAt, votes: q._count.votes }))
  const pollRows: SharedPoll[] = polls
    .map((p) => {
      const options = asOptions(p.options)
      return {
        id: p.id,
        question: p.question,
        status: p.status,
        showResults: p.showResults,
        options,
        counts: options.map((_, i) => p.votes.filter((v) => v.optionIndex === i).length),
        total: p.votes.length,
        createdBy: p.createdBy,
        createdByName: p.createdByName,
      }
    })
    .filter((p) => !mentionsBlockedTerm(p.question, filter) && !p.options.some((o) => mentionsBlockedTerm(o, filter)))
  // Never look up a profile for an anonymous asker.
  const members = await resolveMemberIds([...questions.filter((q) => !q.anonymous).map((q) => q.authorId), ...pollRows.map((p) => p.createdBy)])
  return { questions, polls: pollRows, members }
}

function qaShared(sessionId: string, filter: PostFilter, now: number): Promise<QaShared> {
  const hit = shared.get(sessionId)
  if (hit && now - hit.at < SHARED_VIEW_TTL_MS) return hit.value
  const value = buildShared(sessionId, filter)
  shared.set(sessionId, { at: now, value })
  // A failed build is not kept.
  value.catch(() => {
    if (shared.get(sessionId)?.value === value) shared.delete(sessionId)
  })
  if (shared.size > 50) for (const k of shared.keys()) if (k !== sessionId) shared.delete(k)
  return value
}

export async function memberQaView(
  sessionId: string,
  viewer: { discordId: string; host: boolean },
  filter: PostFilter,
  now: number = Date.now(),
): Promise<{ questions: QuestionView[]; polls: PollView[] }> {
  const sh = await qaShared(sessionId, filter, now)
  // Per viewer, only their own votes.
  const [myQVotes, myPVotes] = await Promise.all([
    prisma.callLiveQuestionVote.findMany({ where: { voterId: viewer.discordId, question: { sessionId } }, select: { questionId: true } }),
    prisma.callLivePollVote.findMany({ where: { voterId: viewer.discordId, poll: { sessionId } }, select: { pollId: true, optionIndex: true } }),
  ])
  const votedQ = new Set(myQVotes.map((v) => v.questionId))
  const votedP = new Map(myPVotes.map((v) => [v.pollId, v.optionIndex]))
  const questions: QuestionView[] = sh.questions
    .filter((q) => viewer.host || !q.hidden)
    .map((q) => ({
      id: q.id,
      text: q.text,
      votes: q.votes,
      voted: votedQ.has(q.id),
      mine: q.authorId === viewer.discordId,
      answered: q.answered,
      pinned: q.pinned,
      createdAt: q.createdAt.toISOString(),
      ...(viewer.host ? { hidden: q.hidden } : {}),
      anonymous: q.anonymous,
      // Anonymous: the name goes to hosts only, and no link (memberId) to anyone.
      author: q.anonymous ? (viewer.host ? { name: q.authorName, memberId: null } : null) : personRef(q.authorName, q.authorId, sh.members),
    }))
  const polls: PollView[] = sh.polls
    .filter((p) => viewer.host || p.status !== 'draft')
    .map((p) => {
      const visible = viewer.host || p.status === 'closed' || p.showResults
      return {
        id: p.id,
        question: p.question,
        status: p.status,
        ...(viewer.host ? { showResults: p.showResults } : {}),
        options: p.options.map((text, i) => ({
          text,
          votes: visible ? p.counts[i] : null,
          percent: visible ? (p.total ? Math.round((p.counts[i] / p.total) * 100) : 0) : null,
        })),
        total: visible ? p.total : null,
        myVote: votedP.get(p.id) ?? null,
        createdBy: personRef(p.createdByName, p.createdBy, sh.members),
      }
    })
  return { questions, polls }
}

// ---- published call page ---------------------------------------------------------------------

export interface PublishedQa {
  answered: Array<{ id: string; text: string; votes: number; author: PersonRef | null }>
  unanswered: Array<{ id: string; text: string; votes: number; author: PersonRef | null }>
  polls: Array<{ id: string; question: string; options: Array<{ text: string; votes: number; percent: number }>; total: number }>
}

/**
 * What the published call page shows. Anonymous askers never appear; hidden questions and draft polls
 * are left out; questions or polls by a reviewer-redacted speaker and anything with a blocked term are dropped.
 */
export async function publishedQa(sessionId: string, redactedIds: readonly string[] = [], filter: PostFilter): Promise<PublishedQa> {
  const hidden = new Set(redactedIds)
  const [qs, polls] = await Promise.all([
    prisma.callLiveQuestion.findMany({ where: { sessionId, hidden: false }, include: { votes: { select: { voterId: true } } }, take: 300 }),
    prisma.callLivePoll.findMany({ where: { sessionId, status: { not: 'draft' } }, orderBy: { createdAt: 'asc' }, include: { votes: { select: { voterId: true, optionIndex: true } } }, take: 20 }),
  ])
  const visibleQs = qs.filter((q) => !hidden.has(q.authorId) && !mentionsBlockedTerm(q.text, filter))
  const members = await resolveMemberIds(visibleQs.filter((q) => !q.anonymous).map((q) => q.authorId))
  const rows = visibleQs
    .map((q) => ({
      id: q.id,
      text: q.text,
      votes: q.votes.filter((v) => !hidden.has(v.voterId)).length,
      answered: q.answered,
      createdAt: q.createdAt.getTime(),
      author: q.anonymous ? null : personRef(q.authorName, q.authorId, members),
    }))
    .sort((a, b) => b.votes - a.votes || a.createdAt - b.createdAt)
  const strip = ({ id, text, votes, author }: (typeof rows)[number]) => ({ id, text, votes, author })
  return {
    answered: rows.filter((r) => r.answered).map(strip),
    unanswered: rows.filter((r) => !r.answered).map(strip),
    polls: polls
      .filter((p) => !hidden.has(p.createdBy))
      .flatMap((p) => {
        const opts = asOptions(p.options)
        if (mentionsBlockedTerm(p.question, filter) || opts.some((o) => mentionsBlockedTerm(o, filter))) return []
        const votes = p.votes.filter((v) => !hidden.has(v.voterId))
        return [
          {
            id: p.id,
            question: p.question,
            total: votes.length,
            options: opts.map((text, i) => {
              const n = votes.filter((v) => v.optionIndex === i).length
              return { text, votes: n, percent: votes.length ? Math.round((n / votes.length) * 100) : 0 }
            }),
          },
        ]
      }),
  }
}

/** The Q&A and polls of a published recording (matched by the recorder session id); null when there are none or the filter cannot be read. Never throws. */
export async function publishedQaForRecording(recordingId: string, loadFilter: () => Promise<PostFilter> = () => loadPostFilter()): Promise<PublishedQa | null> {
  try {
    const rec = await prisma.callRecording.findFirst({ where: { id: recordingId, status: 'PUBLISHED' }, select: { sessionId: true, redactedSpeakerIds: true } })
    if (!rec) return null
    const qa = await publishedQa(rec.sessionId, rec.redactedSpeakerIds ?? [], await loadFilter())
    return qa.answered.length + qa.unanswered.length + qa.polls.length > 0 ? qa : null
  } catch {
    return null
  }
}

// ---- cleanup ---------------------------------------------------------------------------------

/**
 * Q&A and polls of calls that never got a published recording are deleted once they are older than the
 * retention period (votes go with them). Calls with a published recording keep theirs. Never throws.
 */
export async function sweepQa(now: number, retentionDays: number): Promise<number> {
  try {
    const cutoff = new Date(now - retentionDays * 86_400_000)
    const [qSessions, pSessions] = await Promise.all([
      prisma.callLiveQuestion.findMany({ where: { createdAt: { lt: cutoff } }, distinct: ['sessionId'], select: { sessionId: true }, take: 500 }),
      prisma.callLivePoll.findMany({ where: { createdAt: { lt: cutoff } }, distinct: ['sessionId'], select: { sessionId: true }, take: 500 }),
    ])
    const ids = [...new Set([...qSessions, ...pSessions].map((r) => r.sessionId))]
    if (ids.length === 0) return 0
    const kept = new Set((await prisma.callRecording.findMany({ where: { sessionId: { in: ids }, status: 'PUBLISHED' }, select: { sessionId: true } })).map((r) => r.sessionId))
    const drop = ids.filter((id) => !kept.has(id))
    if (drop.length === 0) return 0
    const [a, b] = await Promise.all([
      prisma.callLiveQuestion.deleteMany({ where: { sessionId: { in: drop } } }),
      prisma.callLivePoll.deleteMany({ where: { sessionId: { in: drop } } }),
    ])
    return a.count + b.count
  } catch (err) {
    console.warn('[calls/live] qa sweep failed:', err instanceof Error ? err.message : err)
    return 0
  }
}
