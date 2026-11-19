// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { handleInteraction, type HandlerDeps } from '../handle'
import { PEP_COMMANDS } from '../commands'
import { buildTriviaReply, runTriviaCommand, type TriviaCommandDeps, type TriviaJob } from '../trivia-command'
import { TOGGLES } from '@/app/lib/settings/toggles'

const GUILD = '812097286003359764'
const USER = '100000000000000001'

type Opt = { name: string; type: number; value?: unknown; options?: Opt[] }
const run = (sub: string, subOptions?: Opt[]) => ({
  type: 2,
  guild_id: GUILD,
  channel_id: '900000000000000001',
  application_id: 'app1',
  token: 'tok',
  member: { user: { id: USER, username: 'snax', global_name: 'Snax' }, roles: ['r1'] },
  data: { name: 'trivia', options: [{ name: sub, type: 1, options: subOptions }] },
})

function make(trivia?: Partial<NonNullable<HandlerDeps['trivia']>> | null, admin = false) {
  const t = { enabled: vi.fn(async () => true), rateLimit: vi.fn(async () => null as Date | null), defer: vi.fn() as ReturnType<typeof vi.fn>, ...trivia } as { enabled: ReturnType<typeof vi.fn>; rateLimit: ReturnType<typeof vi.fn>; defer: ReturnType<typeof vi.fn> }
  const deps = { guildId: GUILD, isAdmin: vi.fn(async () => admin), ...(trivia === null ? {} : { trivia: t }) } as unknown as HandlerDeps
  return { deps, t }
}

describe('registration', () => {
  type Opt2 = { type: number; name: string; description: string; options?: readonly Opt2[]; required?: boolean }
  const cmd = (PEP_COMMANDS as readonly { name: string; description: string; options?: readonly Opt2[]; dm_permission?: boolean }[]).find((c) => c.name === 'trivia')!

  it('has leaderboard / start / skip, guild only', () => {
    expect(cmd.options?.map((o) => o.name)).toEqual(['leaderboard', 'start', 'skip', 'report'])
    expect(cmd.dm_permission).toBe(false)
    expect(cmd.options?.find((o) => o.name === 'leaderboard')?.options?.[0]).toMatchObject({ name: 'public', type: 5, required: false })
  })

  it('stays inside Discord limits', () => {
    const walk = (o: { name: string; description: string; options?: readonly Opt2[] }) => {
      expect(o.name.length).toBeLessThanOrEqual(32)
      expect(o.description.length).toBeLessThanOrEqual(100)
      o.options?.forEach(walk)
    }
    walk(cmd)
  })

  it('the master switch is wired to its env var', () => {
    expect(TOGGLES['trivia.enabled'].env).toBe('TRIVIA_DISCORD_ENABLED')
  })
})

describe('/trivia handler', () => {
  it('start and skip are admin only: a non-admin is refused before anything else is checked', async () => {
    for (const sub of ['start', 'skip']) {
      const { deps, t } = make(undefined, false)
      const r = await handleInteraction(run(sub), deps)
      expect(r.data?.embeds?.[0].description).toMatch(/Only admins/)
      expect(t.enabled).not.toHaveBeenCalled()
      expect(t.rateLimit).not.toHaveBeenCalled()
      expect(t.defer).not.toHaveBeenCalled()
    }
  })

  it('an admin starts and skips: deferred EPHEMERAL replies carrying the job', async () => {
    for (const sub of ['start', 'skip']) {
      const { deps, t } = make(undefined, true)
      const r = await handleInteraction(run(sub), deps)
      expect(r.type).toBe(5)
      expect(r.data?.flags).toBe(64)
      expect(t.defer).toHaveBeenCalledWith(expect.objectContaining({ sub, discordId: USER, applicationId: 'app1', token: 'tok' }))
    }
  })

  it('the leaderboard is open to everyone, ephemeral by default and public on request', async () => {
    const a = make(undefined, false)
    const r1 = await handleInteraction(run('leaderboard'), a.deps)
    expect(r1.type).toBe(5)
    expect(r1.data?.flags).toBe(64)
    expect(a.t.defer).toHaveBeenCalledWith(expect.objectContaining({ sub: 'leaderboard' }))
    expect(a.t.defer.mock.calls[0][0]).not.toHaveProperty('public')

    const b = make(undefined, false)
    const r2 = await handleInteraction(run('leaderboard', [{ name: 'public', type: 5, value: true }]), b.deps)
    expect(r2.type).toBe(5)
    expect(r2.data?.flags).toBeUndefined()
    expect(b.t.defer).toHaveBeenCalledWith(expect.objectContaining({ sub: 'leaderboard', public: true }))
  })

  it('start can never be public', async () => {
    const { deps, t } = make(undefined, true)
    const r = await handleInteraction(run('start', [{ name: 'public', type: 5, value: true }]), deps)
    expect(r.data?.flags).toBe(64)
    expect(t.defer.mock.calls[0][0]).not.toHaveProperty('public')
  })

  it('answers "not enabled" while trivia is off: no rate limit use, no deferral', async () => {
    const { deps, t } = make({ enabled: vi.fn(async () => false) }, true)
    const r = await handleInteraction(run('start'), deps)
    expect(r.data?.embeds?.[0].description).toMatch(/isn't enabled/)
    expect(t.rateLimit).not.toHaveBeenCalled()
    expect(t.defer).not.toHaveBeenCalled()
  })

  it('answers "not enabled" when the route wires nothing', async () => {
    const { deps } = make(null)
    expect((await handleInteraction(run('leaderboard'), deps)).data?.embeds?.[0].description).toMatch(/isn't enabled/)
  })

  it('is rate limited', async () => {
    const { deps, t } = make({ rateLimit: vi.fn(async () => new Date(Date.now() + 30_000)) }, true)
    const r = await handleInteraction(run('leaderboard'), deps)
    expect(r.data?.embeds?.[0].description).toMatch(/Slow down/)
    expect(t.defer).not.toHaveBeenCalled()
  })

  it('an unknown subcommand is refused', async () => {
    const { deps, t } = make(undefined, true)
    expect((await handleInteraction(run('answer'), deps)).data?.embeds?.[0].description).toMatch(/Pick one of/)
    expect(t.defer).not.toHaveBeenCalled()
  })
})

const job = (sub: TriviaJob['sub']): TriviaJob => ({ sub, discordId: USER, applicationId: 'app1', token: 'tok' })
const deps = (over: Partial<TriviaCommandDeps> = {}): TriviaCommandDeps => ({
  leaderboard: async () => ({ available: true, month: [{ rank: 1, name: 'Don Pepperoni', score: 3 }], allTime: [{ rank: 1, name: 'Don Pepperoni', score: 9 }, { rank: 2, name: 'Capo', score: 1 }] }),
  startRound: async () => ({ status: 'started', channelId: '900000000000000009' }),
  skipRound: async () => 'cancelled',
  reportLatest: async () => ({ status: 'reported', question: 'How many bitcoins did Laszlo Hanyecz pay for two pizzas in May 2010?' }),
  ...over,
})

describe('/trivia report', () => {
  it('is registered with an optional reason (max 200)', () => {
    const cmd = (PEP_COMMANDS as readonly { name: string; options?: readonly { name: string; options?: readonly { name: string; required?: boolean; max_length?: number }[] }[] }[]).find((c) => c.name === 'trivia')!
    expect(cmd.options?.find((o) => o.name === 'report')?.options?.[0]).toMatchObject({ name: 'reason', required: false, max_length: 200 })
  })

  it('any member may run it (not admin gated), ephemeral, carrying a cleaned reason', async () => {
    const { deps, t } = make(undefined, false)
    const r = await handleInteraction(run('report', [{ name: 'reason', type: 3, value: '  this   is\nbad  ' }]), deps)
    expect(r.type).toBe(5)
    expect(r.data?.flags).toBe(64)
    expect(t.defer).toHaveBeenCalledWith(expect.objectContaining({ sub: 'report', discordId: USER, reason: 'this is bad' }))
  })

  it('without a reason the job carries none; it answers "not enabled" while trivia is off', async () => {
    const a = make(undefined, false)
    await handleInteraction(run('report'), a.deps)
    expect(a.t.defer.mock.calls[0][0]).not.toHaveProperty('reason')
    const b = make({ enabled: vi.fn(async () => false) }, false)
    expect((await handleInteraction(run('report'), b.deps)).data?.embeds?.[0].description).toMatch(/isn't enabled/)
  })

  it("replies \"Thanks, reported '<question>'\" with the question shortened, and says if it was already reported", async () => {
    const ok = await buildTriviaReply({ ...job('report'), reason: 'wrong' }, deps())
    expect(ok.description).toMatch(/Thanks, reported 'How many bitcoins did Laszlo Hanyecz pay for two pizzas/)
    expect(ok.description).toContain('…')
    const reportLatest = vi.fn(async () => ({ status: 'duplicate' as const, question: 'Short one?' }))
    expect((await buildTriviaReply(job('report'), deps({ reportLatest }))).description).toMatch(/already reported 'Short one\?'/)
    expect(reportLatest).toHaveBeenCalledWith(USER, undefined)
    expect((await buildTriviaReply(job('report'), deps({ reportLatest: async () => ({ status: 'none' }) }))).description).toMatch(/no trivia question/)
    expect((await buildTriviaReply(job('report'), deps({ reportLatest: async () => ({ status: 'not_member' }) }))).description).toMatch(/members/)
  })
})

describe('replies', () => {
  it('leaderboard: this month and all time, names only', async () => {
    const e = await buildTriviaReply(job('leaderboard'), deps())
    expect(e.fields?.map((f) => f.name)).toEqual(['This month', 'All time'])
    expect(e.fields?.[1].value).toContain('1. Don Pepperoni: 9 wins')
    expect(e.fields?.[1].value).toContain('2. Capo: 1 win')
    expect(JSON.stringify(e)).not.toMatch(/\d{17,}/)
  })

  it('leaderboard: empty and unavailable', async () => {
    const empty = await buildTriviaReply(job('leaderboard'), deps({ leaderboard: async () => ({ available: true, month: [], allTime: [] }) }))
    expect(empty.fields?.[0].value).toBe('No wins yet.')
    const down = await buildTriviaReply(job('leaderboard'), deps({ leaderboard: async () => ({ available: false, month: [], allTime: [] }) }))
    expect(down.description).toMatch(/not available/)
  })

  it('start: success points at the channel and never shows the question', async () => {
    const e = await buildTriviaReply(job('start'), deps())
    expect(e.description).toContain('<#900000000000000009>')
  })

  it.each(['no_channel', 'open_exists', 'no_question', 'busy', 'post_failed'] as const)('start refused: %s', async (status) => {
    const e = await buildTriviaReply(job('start'), deps({ startRound: async () => ({ status }) }))
    expect(e.description).toMatch(/Couldn't start/)
  })

  it('skip: cancelled, nothing open, no channel', async () => {
    expect((await buildTriviaReply(job('skip'), deps())).description).toMatch(/cancelled[\s\S]*No \$PEP/)
    expect((await buildTriviaReply(job('skip'), deps({ skipRound: async () => 'none_open' }))).description).toMatch(/no open round/)
    expect((await buildTriviaReply(job('skip'), deps({ skipRound: async () => 'no_channel' }))).description).toMatch(/No trivia channel/)
  })

  it('edits the deferred reply through the interaction webhook, and falls back to an error embed', async () => {
    const calls: Array<[string, RequestInit]> = []
    const ok = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response('{}', { status: 200 })
    })
    await runTriviaCommand(job('skip'), { ...deps(), fetchImpl: ok as unknown as typeof fetch })
    expect(calls[0][0]).toBe('https://discord.com/api/v10/webhooks/app1/tok/messages/@original')
    expect(calls[0][1].method).toBe('PATCH')
    expect(JSON.parse(calls[0][1].body as string).allowed_mentions).toEqual({ parse: [] })

    vi.spyOn(console, 'error').mockImplementation(() => {})
    const bodies: string[] = []
    const boom = vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(init.body as string)
      return new Response('{}', { status: 200 })
    })
    await runTriviaCommand(job('start'), { ...deps({ startRound: async () => { throw new Error('db') } }), fetchImpl: boom as unknown as typeof fetch })
    expect(bodies[0]).toContain('Something went wrong')
  })
})
