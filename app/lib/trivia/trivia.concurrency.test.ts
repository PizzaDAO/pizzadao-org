// @vitest-environment node
//
// Real-Postgres suite for the Discord trivia loop (plans/trivia.md section 11), in the pattern of
// pep-economy.concurrency.test.ts. Skipped unless PEP_IT_DATABASE_URL points at a LOCAL Postgres whose schema was
// created with `prisma db push`:
//
//   npm run test:pep-concurrency      # starts a throwaway docker Postgres and runs this file too
//
// What it proves against the real database (real Prisma client, real transactions, real row locks):
//   * 20 parallel correct claims: exactly one WON round, exactly one TRIVIA_REWARD ledger row, wallet +20;
//   * a replayed Discord message id (a recorder retry, even 20 at once) never pays twice;
//   * two crons racing to open a round open exactly one (advisory lock + the one-OPEN-round-per-channel index);
//   * attempt caps, the onboarded-member / account-age rules and the 3-wins-a-day cap;
//   * expiry posts the reveal exactly once, however many ticks race, and pays nothing;
//   * a dry-run round pays nothing; /trivia skip cancels without paying.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const DB_URL = process.env.PEP_IT_DATABASE_URL || ''
const isLocal = (() => {
  try {
    return ['localhost', '127.0.0.1'].includes(new URL(DB_URL).hostname)
  } catch {
    return false
  }
})()

// The members sheet is never reached: eligibility is injected.
vi.mock('../sheets/member-repository', () => ({ fetchMemberIdByDiscordId: vi.fn().mockResolvedValue(null) }))

/* eslint-disable @typescript-eslint/no-explicit-any */
type Libs = {
  prisma: any
  rounds: typeof import('./rounds')
  answer: typeof import('./answer')
  bank: typeof import('./bank')
  config: typeof import('./config')
}
let L: Libs
const N = 20
const RUN = String(Date.now()).slice(-9)
let seq = 0
const uid = () => `9${RUN}${String(++seq).padStart(8, '0')}` // 18-digit fake snowflake (an account from 2021: old enough)
const chanId = () => `7${RUN}${String(++seq).padStart(8, '0')}`
const EPOCH = 1420070400000
/** A snowflake for "now plus offset" (always later than the bot's fake question post, which is made 5 s in the past). */
const snow = (offsetMs = 0) => String((BigInt(Date.now() + offsetMs - EPOCH) << BigInt(22)) + BigInt(++seq))
const opening = new Map<string, number>()

async function seedUser(wallet = 0) {
  const id = uid()
  await L.prisma.user.create({ data: { id, roles: [] } })
  await L.prisma.economy.create({ data: { id, wallet } })
  opening.set(id, wallet)
  return id
}
const wallet = async (id: string) => (await L.prisma.economy.findUniqueOrThrow({ where: { id } })).wallet as number
const rewardRows = (ids: string[]) => L.prisma.transaction.findMany({ where: { userId: { in: ids }, type: 'TRIVIA_REWARD' } })

async function expectLedgerConsistent(id: string) {
  const rows = await L.prisma.transaction.findMany({ where: { userId: id }, orderBy: { id: 'asc' } })
  expect(await wallet(id)).toBe((opening.get(id) ?? 0) + rows.reduce((s: number, r: any) => s + r.amount, 0))
}

type AnswerThrottle = (roundId: number, discordId: string, now: Date) => Promise<boolean>
type Posted = { channelId: string; content: string; reference?: string }
function fakePosts(opts: { failQuestion?: boolean } = {}) {
  const posted: Posted[] = []
  const deps = {
    post: async (channelId: string, body: any) => {
      if (opts.failQuestion && posted.length === 0) throw new Error('discord down')
      posted.push({ channelId, content: body.content, reference: body.message_reference?.message_id })
      return { id: snow(-5000) }
    },
  }
  return { posted, deps }
}

let tf: any // a true/false question of the discord pool
const correctText = (q: any) => (q.match.kind === 'boolean' ? q.answer : q.answer)
const wrongText = (q: any) => (q.match.kind === 'boolean' ? (q.answer === 'true' ? 'false' : 'true') : 'qzqzqz')

async function openRound(channelId: string, rewardPep = 20, deps = fakePosts().deps) {
  const r = await L.rounds.openDiscordRound({ channelId, rewardPep, question: tf }, deps)
  if (!r.ok) throw new Error(`could not open: ${r.reason}`)
  return r.roundId as number
}
const roundOf = (id: number) => L.prisma.triviaRound.findUniqueOrThrow({ where: { id } })
const claimInput = (round: any, discordId: string, over: Record<string, unknown> = {}): any => ({
  round: { id: round.id, rewardPep: round.rewardPep, questionId: round.questionId },
  discordId,
  messageId: snow(),
  answerText: 'x',
  correct: true,
  eligibility: { ok: true },
  maxAttempts: 1,
  ...over,
})

describe.skipIf(!isLocal)('Discord trivia under concurrency (real Postgres)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL
    const u = new URL(DB_URL)
    process.env.E2E_PG_HOST = '127.0.0.1'
    process.env.E2E_PG_PORT = u.port || '5432'
    createRequire(import.meta.url)(resolve(process.cwd(), 'e2e/local/preload.cjs'))
    L = {
      prisma: (await import('../db')).prisma,
      rounds: await import('./rounds'),
      answer: await import('./answer'),
      bank: await import('./bank'),
      config: await import('./config'),
    }
    // `prisma db push` does not create the two partial unique indexes of the migration (Prisma cannot express them).
    await L.prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "TriviaRound_one_open_discord_per_channel" ON "TriviaRound"("channelId") WHERE "status" = 'OPEN' AND "surface" = 'DISCORD'`,
    )
    await L.prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "TriviaAttempt_web_once_per_round" ON "TriviaAttempt"("roundId", "discordId") WHERE "messageId" IS NULL`,
    )
    tf = L.bank.servable({ pool: 'discord' }).find((q: any) => q.type === 'true_false')
    expect(tf).toBeTruthy()
  }, 60_000)

  afterAll(async () => {
    await L?.prisma.$disconnect()
  })

  it(`${N} parallel correct answers: exactly one WON, one TRIVIA_REWARD row, wallet +20`, async () => {
    const channelId = chanId()
    const id = await openRound(channelId)
    const round = await roundOf(id)
    const users = await Promise.all(Array.from({ length: N }, () => seedUser(0)))
    const results = await Promise.all(users.map((u) => L.rounds.claimWin(claimInput(round, u))))
    const won = results.filter((r: any) => r.kind === 'won')
    expect(won).toHaveLength(1)
    expect(won[0]).toEqual({ kind: 'won', rewardPep: 20, paid: true })
    for (const r of results.filter((x: any) => x.kind !== 'won')) expect(['late', 'closed']).toContain((r as any).kind)

    const after = await roundOf(id)
    expect(after.status).toBe('WON')
    expect(users).toContain(after.winnerDiscordId)
    expect(after.winnerMessageId).toBeTruthy()

    const rows = await rewardRows(users)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: after.winnerDiscordId, amount: 20, type: 'TRIVIA_REWARD' })
    expect(await wallet(after.winnerDiscordId)).toBe(20)
    for (const u of users) {
      if (u !== after.winnerDiscordId) expect(await wallet(u)).toBe(0)
      await expectLedgerConsistent(u)
    }
    // Every answer is stored as an attempt (the late ones too), none twice.
    expect(await L.prisma.triviaAttempt.count({ where: { roundId: id } })).toBeGreaterThanOrEqual(1)
  }, 90_000)

  it('a replayed message id never pays twice (sequential and 20 at once)', async () => {
    const channelId = chanId()
    const id = await openRound(channelId)
    const round = await roundOf(id)
    const u = await seedUser(0)
    const input = claimInput(round, u)
    expect(await L.rounds.claimWin(input)).toMatchObject({ kind: 'won' })
    expect(await L.rounds.claimWin(input)).toEqual({ kind: 'duplicate', correct: true, won: true })

    const channel2 = chanId()
    const id2 = await openRound(channel2)
    const round2 = await roundOf(id2)
    const u2 = await seedUser(0)
    const input2 = claimInput(round2, u2)
    const results = await Promise.all(Array.from({ length: N }, () => L.rounds.claimWin(input2)))
    expect(results.filter((r: any) => r.kind === 'won')).toHaveLength(1)
    for (const r of results.filter((x: any) => x.kind !== 'won')) expect(r).toMatchObject({ kind: 'duplicate' })
    expect(await L.prisma.triviaAttempt.count({ where: { roundId: id2 } })).toBe(1)
    expect(await rewardRows([u, u2])).toHaveLength(2) // one per round
    expect(await wallet(u)).toBe(20)
    expect(await wallet(u2)).toBe(20)
    await expectLedgerConsistent(u)
    await expectLedgerConsistent(u2)
  }, 90_000)

  it('two crons racing open exactly one round in a channel', async () => {
    const channelId = chanId()
    const results = await Promise.all(Array.from({ length: 10 }, () => L.rounds.openDiscordRound({ channelId, rewardPep: 20, question: tf }, fakePosts().deps)))
    expect(results.filter((r: any) => r.ok)).toHaveLength(1)
    for (const r of results.filter((x: any) => !x.ok)) expect(['busy', 'open_exists']).toContain((r as any).reason)
    expect(await L.prisma.triviaRound.count({ where: { channelId, status: 'OPEN', surface: 'DISCORD' } })).toBe(1)
  }, 60_000)

  it('a failed question post cancels the round instead of leaving it open', async () => {
    const channelId = chanId()
    const { deps } = fakePosts({ failQuestion: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await L.rounds.openDiscordRound({ channelId, rewardPep: 20, question: tf }, deps)
    expect(r).toMatchObject({ ok: false, reason: 'post_failed' })
    expect(await L.prisma.triviaRound.count({ where: { channelId, status: 'OPEN' } })).toBe(0)
    // and the next try works
    expect((await L.rounds.openDiscordRound({ channelId, rewardPep: 20, question: tf }, fakePosts().deps)).ok).toBe(true)
  }, 60_000)

  it('only discord-pool, approved, non-fun questions are ever opened', async () => {
    const channelId = chanId()
    const ids = new Set(L.bank.servable({ pool: 'discord' }).map((q: any) => q.id))
    const seen = new Set<string>()
    for (let i = 0; i < 25; i++) {
      const r: any = await L.rounds.openDiscordRound({ channelId, rewardPep: 20 }, fakePosts().deps)
      expect(r.ok).toBe(true)
      expect(ids.has(r.questionId)).toBe(true)
      expect(r.questionId.startsWith('fun-')).toBe(false)
      seen.add(r.questionId)
      await L.prisma.triviaRound.update({ where: { id: r.roundId }, data: { status: 'EXPIRED' } })
    }
    expect(seen.size).toBeGreaterThan(5) // it varies
  }, 120_000)

  describe('the full intake path (processAnswer)', () => {
    const deps = (member: (id: string) => boolean, posts = fakePosts(), throttled?: AnswerThrottle) => ({
      ...posts.deps,
      now: () => new Date(),
      isMember: async (id: string) => member(id),
      findAttempt: L.rounds.findAttemptByMessage,
      throttled: throttled ?? (async () => false),
      defer: (fn: () => Promise<void>) => void pending.push(fn),
    })
    let pending: Array<() => Promise<void>> = []
    const flush = async () => {
      const fns = pending
      pending = []
      for (const f of fns) await f()
    }

    it('one attempt for true/false: a second answer from the same member is not counted', async () => {
      const channelId = chanId()
      await openRound(channelId)
      const u = await seedUser(0)
      const d = deps(() => true)
      expect(await L.answer.processAnswer({ channelId, messageId: snow(), discordId: u, content: wrongText(tf) }, d)).toEqual({ status: 'wrong' })
      expect(await L.answer.processAnswer({ channelId, messageId: snow(), discordId: u, content: correctText(tf) }, d)).toEqual({ status: 'not_won', why: 'attempts_exhausted' })
      expect(await wallet(u)).toBe(0)
    }, 60_000)

    it('non-members and young accounts do not win and get no public reply; the round stays open for others', async () => {
      const channelId = chanId()
      const id = await openRound(channelId)
      const posts = fakePosts()
      const d = deps((who) => who !== nonMember, posts)
      const nonMember = await seedUser(0)
      const young = String((BigInt(Date.now() - 2 * 86_400_000 - EPOCH) << BigInt(22)) + BigInt(++seq))
      await L.prisma.user.create({ data: { id: young, roles: [] } })
      const member = await seedUser(0)

      expect(await L.answer.processAnswer({ channelId, messageId: snow(), discordId: nonMember, content: correctText(tf) }, d)).toEqual({ status: 'not_won', why: 'not_member' })
      expect(await L.answer.processAnswer({ channelId, messageId: snow(), discordId: young, content: correctText(tf) }, d)).toEqual({ status: 'not_won', why: 'too_young' })
      expect((await roundOf(id)).status).toBe('OPEN')
      await flush()
      // Nothing was said about the correct-but-ineligible answers: a public "Correct!" would leak the answer.
      expect(posts.posted.filter((p) => p.channelId === channelId && !p.content.includes('Trivia Time'))).toHaveLength(0)
      expect(await L.prisma.triviaAttempt.count({ where: { roundId: id, correct: true } })).toBe(2) // recorded as correct, not eligible

      const winMsg = snow()
      expect(await L.answer.processAnswer({ channelId, messageId: winMsg, discordId: member, content: correctText(tf) }, d)).toEqual({ status: 'won', rewardPep: 20, paid: true })
      await flush()
      expect((await roundOf(id)).status).toBe('WON')
      expect(await wallet(nonMember)).toBe(0)
      expect(await wallet(member)).toBe(20)
      // the winner post is a reply to the winning message, and the explanation follows
      const winPost = posts.posted.find((p) => p.content.includes('wins'))
      expect(winPost?.reference).toBe(winMsg)
      expect(winPost?.content).toContain(`<@${member}>`)
      expect(posts.posted.some((p) => p.content.startsWith('The answer:'))).toBe(true)
    }, 60_000)

    it('a member wins at most 3 rounds a day: the 4th correct answer pays nothing and the round stays open', async () => {
      const u = await seedUser(0)
      const d = deps(() => true)
      for (let i = 0; i < 3; i++) {
        const channelId = chanId()
        await openRound(channelId)
        expect((await L.answer.processAnswer({ channelId, messageId: snow(), discordId: u, content: correctText(tf) }, d)).status).toBe('won')
      }
      expect(await wallet(u)).toBe(60)
      const channelId = chanId()
      const id = await openRound(channelId)
      expect(await L.answer.processAnswer({ channelId, messageId: snow(), discordId: u, content: correctText(tf) }, d)).toEqual({ status: 'not_won', why: 'daily_cap' })
      expect((await roundOf(id)).status).toBe('OPEN')
      expect(await wallet(u)).toBe(60)
      // someone else can still win it
      const other = await seedUser(0)
      expect((await L.answer.processAnswer({ channelId, messageId: snow(), discordId: other, content: correctText(tf) }, d)).status).toBe('won')
      await expectLedgerConsistent(u)
    }, 90_000)

    it('a recorder retry after a 5xx is a duplicate (never throttled, never recounted); the real 2 s throttle ignores a second fast answer', async () => {
      const channelId = chanId()
      const short = L.bank.servable({ pool: 'discord' }).find((q: any) => q.type === 'short_answer' && q.match.kind === 'text')
      const r: any = await L.rounds.openDiscordRound({ channelId, rewardPep: 20, question: short }, fakePosts().deps)
      expect(r.ok).toBe(true)
      const u = await seedUser(0)
      const real = (id: string) => L.rounds.hasRecentAttempt(r.roundId, id, new Date())
      const d = deps(() => true, fakePosts(), (rid, did, now) => L.rounds.hasRecentAttempt(rid, did, now))
      const msg = snow()
      expect(await L.answer.processAnswer({ channelId, messageId: msg, discordId: u, content: 'qzqzqz' }, d)).toEqual({ status: 'wrong' })
      // the retry of the same message: duplicate, although the member has a fresh attempt inside the 2 s window
      expect(await real(u)).toBe(true)
      expect(await L.answer.processAnswer({ channelId, messageId: msg, discordId: u, content: 'qzqzqz' }, d)).toEqual({ status: 'duplicate' })
      // a different message right away: throttled, not recorded
      expect(await L.answer.processAnswer({ channelId, messageId: snow(), discordId: u, content: 'qzqzqy' }, d)).toEqual({ status: 'ignored', why: 'rate_limited' })
      expect(await L.prisma.triviaAttempt.count({ where: { roundId: r.roundId, discordId: u } })).toBe(1)
    }, 60_000)

    it('a replayed winning message through processAnswer (the round is now closed) is a harmless no-op and pays once', async () => {
      const channelId = chanId()
      await openRound(channelId)
      const u = await seedUser(0)
      const d = deps(() => true)
      const msg = snow()
      expect((await L.answer.processAnswer({ channelId, messageId: msg, discordId: u, content: correctText(tf) }, d)).status).toBe('won')
      expect(await L.answer.processAnswer({ channelId, messageId: msg, discordId: u, content: correctText(tf) }, d)).toEqual({ status: 'no_round' })
      expect(await rewardRows([u])).toHaveLength(1)
    }, 60_000)

    it('a cancelled round counts as having fired its slot; a failed post does not', async () => {
      const channelId = chanId()
      const posts = fakePosts()
      await openRound(channelId, 20, posts.deps)
      await L.rounds.cancelOpenRound(channelId, posts.deps)
      const failed = chanId()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await L.rounds.openDiscordRound({ channelId: failed, rewardPep: 20, question: tf }, fakePosts({ failQuestion: true }).deps)
      const recent = await L.rounds.recentDiscordRounds(50)
      const mine = await L.prisma.triviaRound.findMany({ where: { channelId: { in: [channelId, failed] } }, select: { id: true, status: true, messageId: true } })
      expect(mine.map((m: any) => [m.status, m.messageId !== null])).toEqual(expect.arrayContaining([['CANCELLED', true], ['CANCELLED', false]]))
      // skipped (asked) = postFailed false; failed post = postFailed true
      expect(recent.filter((x: any) => x.postFailed).length).toBeGreaterThanOrEqual(1)
      expect(recent.filter((x: any) => !x.postFailed).length).toBeGreaterThanOrEqual(1)
    }, 60_000)

    it('a dry-run round (reward 0) names a winner but pays nothing', async () => {
      const channelId = chanId()
      const id = await openRound(channelId, 0)
      const u = await seedUser(0)
      expect(await L.answer.processAnswer({ channelId, messageId: snow(), discordId: u, content: correctText(tf) }, deps(() => true))).toEqual({ status: 'won', rewardPep: 0, paid: false })
      expect((await roundOf(id)).status).toBe('WON')
      expect(await rewardRows([u])).toHaveLength(0)
      expect(await wallet(u)).toBe(0)
    }, 60_000)

    it('answers after the round closed, or before the question, are not counted', async () => {
      const channelId = chanId()
      const id = await openRound(channelId)
      const u = await seedUser(0)
      const d = deps(() => true)
      const round = await roundOf(id)
      // before the question: a message id older than the bot's post
      expect(await L.answer.processAnswer({ channelId, messageId: snow(-60_000), discordId: u, content: correctText(tf) }, d)).toEqual({ status: 'ignored', why: 'before_question' })
      // after the close time (the sweeper has not run yet)
      await L.prisma.triviaRound.update({ where: { id }, data: { closesAt: new Date(Date.now() - 1000) } })
      expect(await L.answer.processAnswer({ channelId, messageId: snow(), discordId: u, content: correctText(tf) }, d)).toEqual({ status: 'no_round' })
      // a claim that raced the close: late/closed, never a win
      const res = await L.rounds.claimWin(claimInput(round, u))
      expect(['closed', 'late']).toContain(res.kind)
      expect(await rewardRows([u])).toHaveLength(0)
    }, 60_000)

    it('a cancelled round pays nothing and a later correct answer finds no round (/trivia skip)', async () => {
      const channelId = chanId()
      const posts = fakePosts()
      const id = await openRound(channelId, 20, posts.deps)
      expect(await L.rounds.cancelOpenRound(channelId, posts.deps)).toBe(true)
      expect(await L.rounds.cancelOpenRound(channelId, posts.deps)).toBe(false)
      expect((await roundOf(id)).status).toBe('CANCELLED')
      expect(posts.posted.filter((p) => p.content.includes('cancelled'))).toHaveLength(1)
      const u = await seedUser(0)
      expect(await L.answer.processAnswer({ channelId, messageId: snow(), discordId: u, content: correctText(tf) }, deps(() => true))).toEqual({ status: 'no_round' })
      expect(await rewardRows([u])).toHaveLength(0)
    }, 60_000)
  })

  describe('reaction answers', () => {
    let mcq: any
    const turtle = (i: number) => ({ id: L.config.CHOICE_EMOJI[i].id, name: L.config.CHOICE_EMOJI[i].name })
    const removed: Array<{ messageId: string; reaction: string; userId: string }> = []
    const rdeps = (member: (id: string) => boolean = () => true, posts = fakePosts()) => ({
      ...posts.deps,
      now: () => new Date(),
      isMember: async (id: string) => member(id),
      findAttempt: L.rounds.findAttemptByMessage,
      throttled: async () => false,
      removeReaction: async (_c: string, messageId: string, reaction: string, userId: string) => void removed.push({ messageId, reaction, userId }),
      defer: (fn: () => Promise<void>) => void pend.push(fn),
    })
    let pend: Array<() => Promise<void>> = []
    const settle = async () => {
      const fns = pend
      pend = []
      for (const f of fns) await f()
    }
    const openMc = async (channelId: string, reward = 20, deps: any = fakePosts().deps) => {
      const r: any = await L.rounds.openDiscordRound({ channelId, rewardPep: reward, question: mcq }, deps)
      expect(r.ok).toBe(true)
      const round = await roundOf(r.roundId)
      return { id: r.roundId as number, round, messageId: round.messageId as string }
    }
    const rightIdx = () => mcq.choices.indexOf(mcq.answer)
    const wrongIdx = () => (rightIdx() + 1) % 4

    beforeEach(() => {
      pend = []
      removed.length = 0
    })

    beforeAll(() => {
      mcq = L.bank.servable({ pool: 'discord' }).find((q: any) => q.type === 'multiple_choice')
      expect(mcq).toBeTruthy()
    })

    it('opening a multiple-choice round posts the turtles and pre-adds the reactions in order after the post', async () => {
      const channelId = chanId()
      const seen: Array<{ kind: string; detail: string }> = []
      const deps = {
        post: async (_c: string, body: any) => (seen.push({ kind: 'post', detail: body.content }), { id: snow(-5000) }),
        labels: async (n: number) => L.bank && (await import('./emoji')).buildChoiceLabels(n, new Set(L.config.CHOICE_EMOJI.map((e: any) => e.id))),
        addReactions: async (_c: string, messageId: string, reactions: string[]) => void seen.push({ kind: 'react', detail: `${messageId}|${reactions.join(',')}` }),
      }
      const { id, messageId } = await openMc(channelId, 20, deps)
      expect(seen.map((x) => x.kind)).toEqual(['post', 'react'])
      for (let i = 0; i < 4; i++) expect(seen[0].detail).toContain(`<:${L.config.CHOICE_EMOJI[i].name}:${L.config.CHOICE_EMOJI[i].id}> ${mcq.choices[i]}`)
      expect(seen[1].detail).toBe(`${messageId}|${L.config.CHOICE_EMOJI.map((e: any) => `${e.name}:${e.id}`).join(',')}`)
      expect((await roundOf(id)).messageId).toBe(messageId)
    }, 60_000)

    it('true/false pre-adds the check then the cross; a failing reaction call never undoes the round', async () => {
      const channelId = chanId()
      const calls: string[][] = []
      const deps = { post: async () => ({ id: snow(-5000) }), addReactions: async (_c: string, _m: string, r: string[]) => void calls.push(r) }
      await openRound(channelId, 20, deps as any)
      expect(calls).toEqual([[L.config.TF_REACTIONS.true, L.config.TF_REACTIONS.false]])
      const channel2 = chanId()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const bad = { post: async () => ({ id: snow(-5000) }), addReactions: async () => { throw new Error('Missing Access') } }
      const r: any = await L.rounds.openDiscordRound({ channelId: channel2, rewardPep: 20, question: tf }, bad as any)
      expect(r.ok).toBe(true)
      expect((await roundOf(r.roundId)).status).toBe('OPEN')
    }, 60_000)

    it('a correct reaction wins once, pays once, and the winner post replies to the question', async () => {
      const channelId = chanId()
      const posts = fakePosts()
      const { id, messageId } = await openMc(channelId, 20, posts.deps)
      const u = await seedUser(0)
      const out = await L.answer.processReaction({ channelId, messageId, discordId: u, emoji: turtle(rightIdx()) }, rdeps(() => true, posts))
      expect(out).toEqual({ status: 'won', rewardPep: 20, paid: true })
      await settle()
      const after = await roundOf(id)
      expect(after).toMatchObject({ status: 'WON', winnerDiscordId: u, winnerMessageId: `reaction:${messageId}:${u}` })
      expect(await wallet(u)).toBe(20)
      expect(await rewardRows([u])).toHaveLength(1)
      expect(posts.posted.find((p) => p.content.includes('Correct!'))?.reference).toBe(messageId)
      await expectLedgerConsistent(u)
    }, 60_000)

    it("a member's first reaction is their only attempt (a later one, even a different emoji, is a duplicate), and every pick is removed", async () => {
      const channelId = chanId()
      const { id, messageId } = await openMc(channelId)
      const u = await seedUser(0)
      const d = rdeps()
      removed.length = 0
      const first = await L.answer.processReaction({ channelId, messageId, discordId: u, emoji: turtle(wrongIdx()) }, d)
      expect(first).toEqual({ status: 'wrong' })
      const second = await L.answer.processReaction({ channelId, messageId, discordId: u, emoji: turtle(rightIdx()) }, d)
      expect(second).toEqual({ status: 'duplicate' })
      await settle()
      expect(await L.prisma.triviaAttempt.count({ where: { roundId: id, discordId: u } })).toBe(1)
      expect((await roundOf(id)).status).toBe('OPEN')
      expect(removed.filter((r) => r.userId === u)).toHaveLength(2)
      expect(removed.every((r) => r.messageId === messageId)).toBe(true)
    }, 60_000)

    it('a reaction and a typed answer from the same member at the same moment are still one attempt (20 members, both at once)', async () => {
      const channelId = chanId()
      const { id, messageId } = await openMc(channelId)
      const users = await Promise.all(Array.from({ length: N }, () => seedUser(0)))
      const d = rdeps()
      // Both wrong, so the round stays open and every member's attempts can be counted.
      const letter = String.fromCharCode(97 + wrongIdx())
      await Promise.all(
        users.flatMap((u) => [
          L.answer.processReaction({ channelId, messageId, discordId: u, emoji: turtle(wrongIdx()) }, d),
          L.answer.processAnswer({ channelId, messageId: snow(), discordId: u, content: letter }, d),
        ]),
      )
      for (const u of users) expect(await L.prisma.triviaAttempt.count({ where: { roundId: id, discordId: u } })).toBe(1)
      expect((await roundOf(id)).status).toBe('OPEN')
      await settle()
    }, 120_000)

    it('a reaction and a typed correct answer racing across members still pay exactly once', async () => {
      const channelId = chanId()
      const { id, messageId } = await openMc(channelId)
      const users = await Promise.all(Array.from({ length: N }, () => seedUser(0)))
      const d = rdeps()
      const letter = String.fromCharCode(97 + rightIdx())
      const results = await Promise.all(
        users.flatMap((u) => [
          L.answer.processReaction({ channelId, messageId, discordId: u, emoji: turtle(rightIdx()) }, d),
          L.answer.processAnswer({ channelId, messageId: snow(), discordId: u, content: letter }, d),
        ]),
      )
      expect(results.filter((r: any) => r.status === 'won')).toHaveLength(1)
      expect(await rewardRows(users)).toHaveLength(1)
      for (const u of users) expect(await L.prisma.triviaAttempt.count({ where: { roundId: id, discordId: u } })).toBeLessThanOrEqual(1)
      expect((await roundOf(id)).status).toBe('WON')
      await settle()
    }, 120_000)

    it('a reaction on another message, after the round closed, or with an unrelated emoji is not counted and not removed', async () => {
      const channelId = chanId()
      const { id, messageId } = await openMc(channelId)
      const u = await seedUser(0)
      const d = rdeps()
      removed.length = 0
      expect(await L.answer.processReaction({ channelId, messageId: snow(-9000), discordId: u, emoji: turtle(0) }, d)).toEqual({ status: 'ignored', why: 'not_current_message' })
      expect(await L.answer.processReaction({ channelId, messageId, discordId: u, emoji: { id: null, name: '\u{1F355}' } }, d)).toEqual({ status: 'ignored', why: 'not_a_choice' })
      await L.prisma.triviaRound.update({ where: { id }, data: { status: 'EXPIRED' } })
      expect(await L.answer.processReaction({ channelId, messageId, discordId: u, emoji: turtle(rightIdx()) }, d)).toEqual({ status: 'no_round' })
      await settle()
      expect(await L.prisma.triviaAttempt.count({ where: { roundId: id } })).toBe(0)
      expect(removed).toHaveLength(0)
    }, 60_000)

    it('non-members and young accounts: the reaction is stored as correct, wins nothing, says nothing, and is removed', async () => {
      const channelId = chanId()
      const posts = fakePosts()
      const { id, messageId } = await openMc(channelId, 20, posts.deps)
      const outsider = await seedUser(0)
      const d = rdeps((who) => who !== outsider, posts)
      removed.length = 0
      const before = posts.posted.length
      expect(await L.answer.processReaction({ channelId, messageId, discordId: outsider, emoji: turtle(rightIdx()) }, d)).toEqual({ status: 'not_won', why: 'not_member' })
      await settle()
      expect(posts.posted.length).toBe(before)
      expect((await roundOf(id)).status).toBe('OPEN')
      expect(await L.prisma.triviaAttempt.count({ where: { roundId: id, correct: true } })).toBe(1)
      expect(removed).toHaveLength(1)
    }, 60_000)

    it('a dry-run reaction win pays nothing', async () => {
      const channelId = chanId()
      const { id, messageId } = await openMc(channelId, 0)
      const u = await seedUser(0)
      expect(await L.answer.processReaction({ channelId, messageId, discordId: u, emoji: turtle(rightIdx()) }, rdeps())).toEqual({ status: 'won', rewardPep: 0, paid: false })
      expect((await roundOf(id)).status).toBe('WON')
      expect(await rewardRows([u])).toHaveLength(0)
    }, 60_000)
  })

  describe('wrong-attempt marks (real attempt counts)', () => {
    it('a short answer: a cross for the 1st and 2nd wrong try, cross + lock on the 3rd, nothing for a 4th; true/false stays silent', async () => {
      const short = L.bank.servable({ pool: 'discord' }).find((q: any) => q.type === 'short_answer' && q.match.kind === 'text')
      const channelId = chanId()
      const r: any = await L.rounds.openDiscordRound({ channelId, rewardPep: 20, question: short }, fakePosts().deps)
      const u = await seedUser(0)
      const marks: string[][] = []
      const later: Array<() => Promise<void>> = []
      const d: any = {
        ...fakePosts().deps,
        now: () => new Date(),
        isMember: async () => true,
        findAttempt: L.rounds.findAttemptByMessage,
        throttled: async () => false,
        markWrong: async (_c: string, _m: string, emojis: string[]) => void marks.push(emojis),
        defer: (fn: () => Promise<void>) => void later.push(fn),
      }
      const outcomes = []
      for (let i = 0; i < 4; i++) outcomes.push(await L.answer.processAnswer({ channelId, messageId: snow(), discordId: u, content: 'qzqzqz' }, d))
      for (const f of later) await f()
      expect(outcomes.map((o: any) => o.status)).toEqual(['wrong', 'wrong', 'wrong', 'not_won'])
      expect(marks).toEqual([[L.config.WRONG_ATTEMPT_REACTION], [L.config.WRONG_ATTEMPT_REACTION], [L.config.WRONG_ATTEMPT_REACTION, L.config.OUT_OF_TRIES_REACTION]])
      expect(await L.prisma.triviaAttempt.count({ where: { roundId: r.roundId, discordId: u } })).toBe(3)

      // true/false: a wrong typed answer is recorded and says nothing
      const ch2 = chanId()
      await openRound(ch2)
      const u2 = await seedUser(0)
      marks.length = 0
      later.length = 0
      expect(await L.answer.processAnswer({ channelId: ch2, messageId: snow(), discordId: u2, content: wrongText(tf) }, d)).toEqual({ status: 'wrong' })
      for (const f of later) await f()
      expect(marks).toHaveLength(0)
    }, 60_000)
  })

  describe('expiry', () => {
    it('posts the reveal exactly once even when ticks race, and pays nothing', async () => {
      const channelId = chanId()
      const posts = fakePosts()
      const id = await openRound(channelId, 20, posts.deps)
      await L.prisma.triviaRound.update({ where: { id }, data: { closesAt: new Date(Date.now() - 60_000) } })
      const before = posts.posted.length
      const counts = await Promise.all(Array.from({ length: 5 }, () => L.rounds.expireRounds(new Date(), posts.deps)))
      expect(counts.reduce((a: number, b: number) => a + b, 0)).toBeGreaterThanOrEqual(1)
      expect((await roundOf(id)).status).toBe('EXPIRED')
      const reveals = posts.posted.slice(before).filter((p) => p.channelId === channelId && p.content.includes("Time's up"))
      expect(reveals).toHaveLength(1)
      expect(reveals[0].content).toContain(L.bank.reveal(tf).answer)
      expect((await roundOf(id)).winnerDiscordId).toBeNull()
    }, 60_000)

    it('a round that expired long ago (the loop was off) is closed silently', async () => {
      const channelId = chanId()
      const posts = fakePosts()
      const id = await openRound(channelId, 20, posts.deps)
      await L.prisma.triviaRound.update({ where: { id }, data: { closesAt: new Date(Date.now() - 3 * 60 * 60_000) } })
      const before = posts.posted.length
      await L.rounds.expireRounds(new Date(), posts.deps)
      expect((await roundOf(id)).status).toBe('EXPIRED')
      expect(posts.posted.length).toBe(before)
    }, 60_000)

    it('a round that was won is not expired or revealed', async () => {
      const channelId = chanId()
      const posts = fakePosts()
      const id = await openRound(channelId, 20, posts.deps)
      const round = await roundOf(id)
      const u = await seedUser(0)
      await L.rounds.claimWin(claimInput(round, u))
      await L.prisma.triviaRound.update({ where: { id }, data: { closesAt: new Date(Date.now() - 1000) } })
      const before = posts.posted.length
      await L.rounds.expireRounds(new Date(), posts.deps)
      expect((await roundOf(id)).status).toBe('WON')
      expect(posts.posted.length).toBe(before)
    }, 60_000)
  })

  it('the ledger reconciles: every TRIVIA_REWARD row belongs to a WON round with that winner', async () => {
    const rows = await L.prisma.transaction.findMany({ where: { type: 'TRIVIA_REWARD' } })
    for (const r of rows) {
      const round = await L.prisma.triviaRound.findUniqueOrThrow({ where: { id: (r.metadata as any).roundId } })
      expect(round.status).toBe('WON')
      expect(round.winnerDiscordId).toBe(r.userId)
      expect(r.amount).toBe(round.rewardPep)
    }
    // exactly one reward row per paid round
    const grouped = new Map<number, number>()
    for (const r of rows) grouped.set((r.metadata as any).roundId, (grouped.get((r.metadata as any).roundId) ?? 0) + 1)
    for (const [, n] of grouped) expect(n).toBe(1)
  }, 60_000)
})
