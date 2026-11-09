/**
 * Live Q&A and polls of a live call (Slido-style). Tied to the recorder session id and kept after the
 * call (the published call page shows them, gated like action items).
 *
 * Privacy rules enforced here, in one place:
 *  - an anonymous asker's id and name only ever go to hosts, and never with a profile link;
 *  - hidden (moderated) questions and draft polls reach hosts only;
 *  - poll counts reach members only once the host allows it (showResults) or the poll is closed.
 */
import { z } from 'zod'
import { prisma } from '@/app/lib/db'
import type { Settings } from '@/app/lib/settings'
import { personRef, resolveMemberIds, type PersonRef } from './live-members'

export const MAX_QUESTION_CHARS = 280
export const MIN_QUESTION_CHARS = 3
export const MAX_POLL_QUESTION_CHARS = 200
export const MAX_POLL_OPTION_CHARS = 80
export const MIN_POLL_OPTIONS = 2
export const MAX_POLL_OPTIONS = 6
/** Votes (questions and polls) a member may cast per minute (best effort, per server instance). */
export const VOTES_PER_MINUTE = 40
const MAX_QUESTIONS_SHOWN = 150

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

// ---- rate limit for votes --------------------------------------------------------------------

const voteLog = new Map<string, number[]>()
export function clearVoteLimiter(): void {
  voteLog.clear()
}
function allowVote(voterId: string, now: number): boolean {
  const recent = (voteLog.get(voterId) ?? []).filter((t) => now - t < 60_000)
  if (recent.length >= VOTES_PER_MINUTE) {
    voteLog.set(voterId, recent)
    return false
  }
  recent.push(now)
  voteLog.set(voterId, recent)
  if (voteLog.size > 5000) voteLog.clear()
  return true
}

// ---- actions ---------------------------------------------------------------------------------

export const actionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('ask'), text: z.string().max(2000), anonymous: z.boolean().optional() }),
  z.object({ op: z.literal('vote'), questionId: z.string().min(1).max(60) }),
  z.object({
    op: z.literal('moderate'),
    questionId: z.string().min(1).max(60),
    action: z.enum(['answer', 'unanswer', 'pin', 'unpin', 'hide', 'unhide']),
  }),
  z.object({
    op: z.literal('createPoll'),
    question: z.string().max(1000),
    options: z.array(z.string().max(500)).min(MIN_POLL_OPTIONS).max(MAX_POLL_OPTIONS),
    showResults: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('pollAction'),
    pollId: z.string().min(1).max(60),
    action: z.enum(['open', 'close', 'showResults', 'hideResults']),
  }),
  z.object({ op: z.literal('pollVote'), pollId: z.string().min(1).max(60), option: z.number().int().min(0).max(MAX_POLL_OPTIONS - 1) }),
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

export async function askQuestion(ctx: Ctx, input: { text: string; anonymous?: boolean }): Promise<{ id: string }> {
  const now = ctx.now ?? Date.now()
  const text = cleanLine(input.text, 2000)
  if (text.length < MIN_QUESTION_CHARS) throw new LiveQaError(400, 'too-short')
  if (text.length > MAX_QUESTION_CHARS) throw new LiveQaError(400, 'too-long')
  const max = ctx.settings.get('calls.liveQuestionMaxPerMember')
  const gapMs = ctx.settings.get('calls.liveQuestionMinGapSeconds') * 1000
  const mine = { sessionId: ctx.sessionId, authorId: ctx.actor.discordId }
  if ((await prisma.callLiveQuestion.count({ where: mine })) >= max) throw new LiveQaError(429, 'limit')
  if (gapMs > 0) {
    const last = await prisma.callLiveQuestion.findFirst({ where: mine, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
    if (last && now - last.createdAt.getTime() < gapMs) throw new LiveQaError(429, 'too-fast')
  }
  const row = await prisma.callLiveQuestion.create({
    data: { ...mine, authorName: ctx.actor.name ? cleanLine(ctx.actor.name, 100) : null, text, anonymous: input.anonymous === true },
    select: { id: true },
  })
  return { id: row.id }
}

export async function toggleQuestionVote(ctx: Ctx, questionId: string): Promise<{ voted: boolean }> {
  if (!allowVote(ctx.actor.discordId, ctx.now ?? Date.now())) throw new LiveQaError(429, 'too-fast')
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
    // One highlighted question at a time.
    await prisma.callLiveQuestion.updateMany({ where: { sessionId: ctx.sessionId, pinned: true }, data: { pinned: false } })
    await prisma.callLiveQuestion.update({ where: { id: questionId }, data: { pinned: true } })
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

export async function pollAction(ctx: Ctx, pollId: string, action: 'open' | 'close' | 'showResults' | 'hideResults'): Promise<void> {
  if (!ctx.actor.host) throw new LiveQaError(403, 'forbidden')
  const poll = await prisma.callLivePoll.findFirst({ where: { id: pollId, sessionId: ctx.sessionId }, select: { id: true, status: true } })
  if (!poll) throw new LiveQaError(404, 'not-found')
  const now = new Date(ctx.now ?? Date.now())
  if (action === 'open') {
    if (poll.status !== 'draft') throw new LiveQaError(409, 'not-draft')
    if ((await prisma.callLivePoll.count({ where: { sessionId: ctx.sessionId, status: 'open' } })) > 0) throw new LiveQaError(409, 'another-open')
    await prisma.callLivePoll.update({ where: { id: pollId }, data: { status: 'open', openedAt: now } })
  } else if (action === 'close') {
    if (poll.status !== 'open') throw new LiveQaError(409, 'not-open')
    await prisma.callLivePoll.update({ where: { id: pollId }, data: { status: 'closed', closedAt: now } })
  } else {
    await prisma.callLivePoll.update({ where: { id: pollId }, data: { showResults: action === 'showResults' } })
  }
}

export async function votePoll(ctx: Ctx, pollId: string, option: number): Promise<void> {
  if (!allowVote(ctx.actor.discordId, ctx.now ?? Date.now())) throw new LiveQaError(429, 'too-fast')
  const poll = await prisma.callLivePoll.findFirst({ where: { id: pollId, sessionId: ctx.sessionId }, select: { status: true, options: true } })
  if (!poll || poll.status === 'draft') throw new LiveQaError(404, 'not-found')
  if (poll.status !== 'open') throw new LiveQaError(409, 'closed')
  const count = Array.isArray(poll.options) ? poll.options.length : 0
  if (option < 0 || option >= count) throw new LiveQaError(400, 'bad-option')
  // One vote per member (composite key); voting again changes it while the poll is open.
  await prisma.callLivePollVote.upsert({
    where: { pollId_voterId: { pollId, voterId: ctx.actor.discordId } },
    create: { pollId, voterId: ctx.actor.discordId, optionIndex: option },
    update: { optionIndex: option },
  })
}

export async function runLiveAction(ctx: Ctx, action: LiveAction): Promise<Record<string, unknown>> {
  switch (action.op) {
    case 'ask':
      return askQuestion(ctx, action)
    case 'vote':
      return toggleQuestionVote(ctx, action.questionId)
    case 'moderate':
      await moderateQuestion(ctx, action.questionId, action.action)
      return {}
    case 'createPoll':
      return createPoll(ctx, action)
    case 'pollAction':
      await pollAction(ctx, action.pollId, action.action)
      return {}
    case 'pollVote':
      await votePoll(ctx, action.pollId, action.option)
      return {}
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

export async function memberQaView(sessionId: string, viewer: { discordId: string; host: boolean }): Promise<{ questions: QuestionView[]; polls: PollView[] }> {
  const [qs, polls] = await Promise.all([
    prisma.callLiveQuestion.findMany({
      where: { sessionId, ...(viewer.host ? {} : { hidden: false }) },
      orderBy: { createdAt: 'desc' },
      take: MAX_QUESTIONS_SHOWN,
      include: { votes: { select: { voterId: true } } },
    }),
    prisma.callLivePoll.findMany({
      where: { sessionId, ...(viewer.host ? {} : { status: { not: 'draft' } }) },
      orderBy: { createdAt: 'asc' },
      take: 20,
      include: { votes: { select: { voterId: true, optionIndex: true } } },
    }),
  ])
  const members = await resolveMemberIds([...qs.filter((q) => !q.anonymous).map((q) => q.authorId), ...polls.map((p) => p.createdBy)])
  const questions: QuestionView[] = qs.map((q) => ({
    id: q.id,
    text: q.text,
    votes: q.votes.length,
    voted: q.votes.some((v) => v.voterId === viewer.discordId),
    mine: q.authorId === viewer.discordId,
    answered: q.answered,
    pinned: q.pinned,
    createdAt: q.createdAt.toISOString(),
    ...(viewer.host ? { hidden: q.hidden } : {}),
    anonymous: q.anonymous,
    // Anonymous: the name goes to hosts only, and no link (memberId) to anyone.
    author: q.anonymous ? (viewer.host ? { name: q.authorName, memberId: null } : null) : personRef(q.authorName, q.authorId, members),
  }))
  return {
    questions,
    polls: polls.map((p) => pollView(p, viewer, members)),
  }
}

function pollView(
  p: { id: string; question: string; status: string; showResults: boolean; options: unknown; createdBy: string; createdByName: string | null; votes: Array<{ voterId: string; optionIndex: number }> },
  viewer: { discordId: string; host: boolean },
  members: ReadonlyMap<string, string>,
): PollView {
  const opts = asOptions(p.options)
  const visible = viewer.host || p.status === 'closed' || p.showResults
  const counts = opts.map((_, i) => p.votes.filter((v) => v.optionIndex === i).length)
  const total = p.votes.length
  return {
    id: p.id,
    question: p.question,
    status: p.status,
    ...(viewer.host ? { showResults: p.showResults } : {}),
    options: opts.map((text, i) => ({
      text,
      votes: visible ? counts[i] : null,
      percent: visible ? (total ? Math.round((counts[i] / total) * 100) : 0) : null,
    })),
    total: visible ? total : null,
    myVote: p.votes.find((v) => v.voterId === viewer.discordId)?.optionIndex ?? null,
    createdBy: personRef(p.createdByName, p.createdBy, members),
  }
}

// ---- published call page ---------------------------------------------------------------------

export interface PublishedQa {
  answered: Array<{ id: string; text: string; votes: number; author: PersonRef | null }>
  unanswered: Array<{ id: string; text: string; votes: number; author: PersonRef | null }>
  polls: Array<{ id: string; question: string; options: Array<{ text: string; votes: number; percent: number }>; total: number }>
}

/**
 * What the published call page shows. Anonymous askers never appear; hidden questions and draft polls
 * are left out; questions or polls by a reviewer-redacted speaker are dropped.
 */
export async function publishedQa(sessionId: string, redactedIds: readonly string[] = []): Promise<PublishedQa> {
  const hidden = new Set(redactedIds)
  const [qs, polls] = await Promise.all([
    prisma.callLiveQuestion.findMany({ where: { sessionId, hidden: false }, include: { votes: { select: { voterId: true } } }, take: 300 }),
    prisma.callLivePoll.findMany({ where: { sessionId, status: { not: 'draft' } }, orderBy: { createdAt: 'asc' }, include: { votes: { select: { voterId: true, optionIndex: true } } }, take: 20 }),
  ])
  const visibleQs = qs.filter((q) => !hidden.has(q.authorId))
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
    .map(({ answered, createdAt, ...rest }) => ({ ...rest, answered, createdAt }))
  const strip = ({ id, text, votes, author }: (typeof rows)[number]) => ({ id, text, votes, author })
  return {
    answered: rows.filter((r) => r.answered).map(strip),
    unanswered: rows.filter((r) => !r.answered).map(strip),
    polls: polls.map((p) => {
      const opts = asOptions(p.options)
      const votes = p.votes.filter((v) => !hidden.has(v.voterId))
      return {
        id: p.id,
        question: p.question,
        total: votes.length,
        options: opts.map((text, i) => {
          const n = votes.filter((v) => v.optionIndex === i).length
          return { text, votes: n, percent: votes.length ? Math.round((n / votes.length) * 100) : 0 }
        }),
      }
    }),
  }
}

/** The Q&A and polls of a published recording (matched by the recorder session id); empty when there are none. Never throws. */
export async function publishedQaForRecording(recordingId: string): Promise<PublishedQa | null> {
  try {
    const rec = await prisma.callRecording.findFirst({ where: { id: recordingId, status: 'PUBLISHED' }, select: { sessionId: true, redactedSpeakerIds: true } })
    if (!rec) return null
    const qa = await publishedQa(rec.sessionId, rec.redactedSpeakerIds ?? [])
    return qa.answered.length + qa.unanswered.length + qa.polls.length > 0 ? qa : null
  } catch {
    return null
  }
}
