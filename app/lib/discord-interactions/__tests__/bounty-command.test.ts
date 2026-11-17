// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { handleInteraction, type HandlerDeps } from '../handle'
import { BOUNTY_COMMAND } from '../commands'
import { buildBountyReply, renderList, runBountyCommand, type BountyDeps, type BountyJob, type BountyRow } from '../bounty-command'
import { ConflictError, NotFoundError, ValidationError } from '@/app/lib/errors/api-errors'
import { TOGGLES } from '@/app/lib/settings/toggles'

const GUILD = '812097286003359764'
const ME = '100000000000000001'
const APP = 'https://app.example.org'

describe('registration', () => {
  type Opt = { type: number; name: string; description: string; options?: readonly Opt[]; max_length?: number }
  const bounty = BOUNTY_COMMAND as unknown as { name: string; description: string; options?: readonly Opt[]; dm_permission?: boolean }

  it('has the four subcommands, guild only', () => {
    expect(bounty.options?.map((o) => o.name)).toEqual(['list', 'claim', 'mine', 'giveup'])
    expect(bounty.options?.every((o) => o.type === 1)).toBe(true)
    expect(bounty.dm_permission).toBe(false)
    const claim = bounty.options?.find((o) => o.name === 'claim')?.options?.[0]
    expect(claim).toMatchObject({ name: 'bounty', type: 4, required: true, autocomplete: true, min_value: 1 })
    expect(bounty.options?.find((o) => o.name === 'list')?.options?.[0]).toMatchObject({ name: 'crew', type: 3, required: false, autocomplete: true, max_length: 80 })
  })

  it('stays inside Discord limits (names <= 32, descriptions <= 100)', () => {
    const walk = (o: { name: string; description: string; options?: readonly Opt[] }) => {
      expect(o.name.length).toBeLessThanOrEqual(32)
      expect(o.description.length).toBeLessThanOrEqual(100)
      o.options?.forEach(walk)
    }
    walk(bounty)
  })

  it('the toggle is wired to its env var', () => {
    expect(TOGGLES['discord.bountyCommandEnabled'].env).toBe('BOUNTY_COMMAND_ENABLED')
  })
})

const row = (id: number, over: Partial<BountyRow> = {}): BountyRow => ({ id, description: `Do thing ${id}`, reward: 1000 + id, crewId: null, status: 'OPEN', ...over })
const labels = new Map([['ops', 'Ops Crew']])

describe('renderers', () => {
  it('lines read #id · reward · crew · description, with the crew label', () => {
    const e = renderList([row(7, { reward: 12345, crewId: 'ops' }), row(8)], APP, labels)
    expect(e.description).toContain('#7 · 12,345 $PEP · Ops Crew · Do thing 7')
    expect(e.description).toContain('#8 · 1,008 $PEP · General · Do thing 8')
    expect(e.description).toContain('2 open bounties')
    expect(e.description).toContain('Claim one with `/bounty claim`')
    expect(e.description).toContain(`(<${APP}/pep>)`)
  })

  it('flattens newlines, truncates to about 90 chars and escapes markdown and mentions', () => {
    const long = 'x'.repeat(200)
    const e = renderList([row(1, { description: 'line one\n\nline *two* @everyone' }), row(2, { description: long })], APP, labels)
    const body = e.description!
    expect(body).toContain('line one line \\*two\\* @​everyone')
    expect(body).not.toContain('x'.repeat(91))
    expect(body).toContain('…')
  })

  it('truncates by code points, so an emoji is never split', () => {
    const e = renderList([row(1, { description: '🍕'.repeat(200) })], APP, labels)
    expect(e.description).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
    expect(e.description).toContain('🍕'.repeat(89) + '…')
  })

  it('caps at 10 with "N more on the website" and stays under 4,000 characters', () => {
    const rows = Array.from({ length: 14 }, (_, i) => row(i + 1, { description: 'y'.repeat(300) }))
    const e = renderList(rows, APP, labels)
    expect(e.description!.match(/#\d+ ·/g)).toHaveLength(10)
    expect(e.description).toContain('4 more on the website')
    expect(e.description!.length).toBeLessThan(4000)
  })

  it('empty state for all bounties and for one crew, with the post-a-bounty link', () => {
    const all = renderList([], APP, labels).description!
    expect(all).toContain('No open bounties right now.')
    expect(all).toContain('Post a bounty with an escrowed $PEP reward')
    expect(all).toContain(`(<${APP}/pep>)`)
    const crew = renderList([], APP, labels, 'ops').description!
    expect(crew).toContain('No open bounties right now for Ops Crew.')
    expect(crew).toContain(`(<${APP}/crew/ops#bounties>)`)
  })
})

const job = (over: Partial<BountyJob> = {}): BountyJob => ({ sub: 'list', discordId: ME, applicationId: 'app1', token: 'tok', ...over })
function makeDeps(over: Partial<BountyDeps> = {}) {
  const d = {
    openBounties: vi.fn(async () => [row(1), row(2)]),
    claimedBy: vi.fn(async () => [] as BountyRow[]),
    claim: vi.fn(async (_id: string, bountyId: number) => row(bountyId, { reward: 500 })),
    giveUp: vi.fn(async () => undefined),
    isMember: vi.fn(async () => true),
    crewLabels: vi.fn(async () => labels),
    appUrl: APP,
    ...over,
  }
  return d
}
const text = async (j: BountyJob, d: BountyDeps) => (await buildBountyReply(j, d)).description!

describe('buildBountyReply', () => {
  it('a non-member is told to finish onboarding and nothing is called', async () => {
    const d = makeDeps({ isMember: vi.fn(async () => false) })
    for (const sub of ['list', 'claim', 'mine', 'giveup'] as const) {
      expect(await text(job({ sub, bountyId: 5 }), d)).toMatch(/Finish onboarding first/)
    }
    expect(d.claim).not.toHaveBeenCalled()
    expect(d.giveUp).not.toHaveBeenCalled()
    expect(d.openBounties).not.toHaveBeenCalled()
  })

  it('list passes the crew filter through', async () => {
    const d = makeDeps()
    await buildBountyReply(job({ crewId: 'ops' }), d)
    expect(d.openBounties).toHaveBeenCalledWith('ops')
  })

  it('claim succeeds with the next steps and the right board link', async () => {
    const d = makeDeps({ claim: vi.fn(async (_id: string, b: number) => row(b, { reward: 2500, crewId: 'ops' })) })
    const t = await text(job({ sub: 'claim', bountyId: 12 }), d)
    expect(t).toContain('You claimed #12 (2,500 $PEP).')
    expect(t).toContain('submit your work on the website')
    expect(t).toContain(`(<${APP}/crew/ops#bounties>)`)
    expect(d.claim).toHaveBeenCalledWith(ME, 12)
    const general = await text(job({ sub: 'claim', bountyId: 3 }), makeDeps())
    expect(general).toContain(`(<${APP}/pep>)`)
  })

  it.each([
    [new ConflictError('Bounty is not available'), 'Someone else claimed it, or it was closed.'],
    [new ValidationError('Cannot claim your own bounty'), 'Cannot claim your own bounty'],
    [new NotFoundError('Bounty'), 'Bounty not found'],
  ])('claim maps %s', async (err, expected) => {
    const t = await text(job({ sub: 'claim', bountyId: 1 }), makeDeps({ claim: vi.fn(async () => { throw err }) }))
    expect(t).toContain(expected)
    expect(t).toMatch(/^❌/)
  })

  it('claim lets unexpected errors through (the runner turns them into the generic reply)', async () => {
    await expect(buildBountyReply(job({ sub: 'claim', bountyId: 1 }), makeDeps({ claim: vi.fn(async () => { throw new Error('db down') }) }))).rejects.toThrow('db down')
  })

  it('mine with nothing claimed, and with CLAIMED and SUBMITTED bounties', async () => {
    expect(await text(job({ sub: 'mine' }), makeDeps())).toMatch(/haven't claimed any bounties/)
    const d = makeDeps({ claimedBy: vi.fn(async () => [row(4, { status: 'CLAIMED' }), row(5, { status: 'SUBMITTED' })]) })
    const t = await text(job({ sub: 'mine' }), d)
    expect(t).toContain('Your bounties (2)')
    expect(t).toMatch(/#4 .*· claimed/)
    expect(t).toMatch(/#5 .*· submitted, waiting for review/)
    expect(d.claimedBy).toHaveBeenCalledWith(ME)
  })

  it('giveup succeeds, and says so when the bounty is not yours', async () => {
    const d = makeDeps()
    expect(await text(job({ sub: 'giveup', bountyId: 9 }), d)).toContain('You gave up #9.')
    expect(d.giveUp).toHaveBeenCalledWith(ME, 9)
    const bad = makeDeps({ giveUp: vi.fn(async () => { throw new ValidationError('You have not claimed this bounty') }) })
    expect(await text(job({ sub: 'giveup', bountyId: 9 }), bad)).toContain('You have not claimed this bounty')
  })
})

describe('runBountyCommand', () => {
  it('PATCHes @original once with no pings', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    await runBountyCommand(job(), makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://discord.com/api/v10/webhooks/app1/tok/messages/@original')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string).allowed_mentions).toEqual({ parse: [] })
  })

  it('falls back to the generic error reply when deps throw, and never throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    const d = makeDeps({ openBounties: vi.fn(async () => { throw new Error('boom') }), fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(runBountyCommand(job(), d)).resolves.toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).embeds[0].description).toMatch(/Something went wrong/)
  })
})

// ---------------------------------------------------------------- handler ---

function make(over: { enabled?: boolean; readyAt?: Date | null } = {}) {
  const b = {
    enabled: vi.fn(async () => over.enabled ?? true),
    rateLimit: vi.fn(async () => over.readyAt ?? null),
    defer: vi.fn(),
    choices: vi.fn(async () => [{ name: '#1 · 5 $PEP · x', value: 1 }]),
  }
  return { deps: { guildId: GUILD, bounty: b } as unknown as HandlerDeps, b }
}
const sub = (name: string, options: Array<{ name: string; type: number; value?: unknown; focused?: boolean }> = [], type = 2) => ({
  type,
  guild_id: GUILD,
  application_id: 'app1',
  token: 'tok',
  member: { user: { id: ME, username: 'someone' }, roles: [] },
  data: { name: 'bounty', options: [{ name, type: 1, options }] },
})

describe('handler', () => {
  it('while off: "isn\'t enabled yet", ephemeral, no rate limit, no deferral', async () => {
    const { deps, b } = make({ enabled: false })
    const r = await handleInteraction(sub('list'), deps)
    expect(r.data?.embeds?.[0].description).toMatch(/isn't enabled yet/)
    expect(r.data?.flags).toBe(64)
    expect(b.rateLimit).not.toHaveBeenCalled()
    expect(b.defer).not.toHaveBeenCalled()
    const none = await handleInteraction(sub('list'), { guildId: GUILD } as unknown as HandlerDeps)
    expect(none.data?.embeds?.[0].description).toMatch(/isn't enabled yet/)
  })

  it('on: defers an EPHEMERAL reply with the right job', async () => {
    const { deps, b } = make()
    const r = await handleInteraction(sub('claim', [{ name: 'bounty', type: 4, value: 42 }]), deps)
    expect(r).toMatchObject({ type: 5, data: { flags: 64 } })
    expect(b.defer).toHaveBeenCalledWith(expect.objectContaining({ sub: 'claim', discordId: ME, bountyId: 42, applicationId: 'app1', token: 'tok' }))
    await handleInteraction(sub('list', [{ name: 'crew', type: 3, value: 'Ops' }]), deps)
    expect(b.defer).toHaveBeenLastCalledWith(expect.objectContaining({ sub: 'list', crewId: 'ops' }))
    expect(b.defer.mock.calls[1][0]).not.toHaveProperty('bountyId')
    await handleInteraction(sub('mine'), deps)
    expect(b.defer).toHaveBeenLastCalledWith(expect.objectContaining({ sub: 'mine' }))
    await handleInteraction(sub('giveup', [{ name: 'bounty', type: 4, value: 7 }]), deps)
    expect(b.defer).toHaveBeenLastCalledWith(expect.objectContaining({ sub: 'giveup', bountyId: 7 }))
  })

  it('rejects a bad bounty or crew option before deferring', async () => {
    const { deps, b } = make()
    for (const value of [0, -3, 1.5, 'abc', undefined]) {
      const r = await handleInteraction(sub('claim', value === undefined ? [] : [{ name: 'bounty', type: 4, value }]), deps)
      expect(r.data?.embeds?.[0].description).toMatch(/Pick a bounty/)
    }
    const bad = await handleInteraction(sub('list', [{ name: 'crew', type: 3, value: '!!!' }]), deps)
    expect(bad.data?.embeds?.[0].description).toMatch(/Pick a crew/)
    expect(b.defer).not.toHaveBeenCalled()
  })

  it('an unknown subcommand is refused', async () => {
    const { deps, b } = make()
    expect((await handleInteraction(sub('nope'), deps)).data?.embeds?.[0].description).toMatch(/Pick one of/)
    expect(b.defer).not.toHaveBeenCalled()
  })

  it('when rate limited: a wait message and no deferral', async () => {
    const { deps, b } = make({ readyAt: new Date(Date.now() + 30_000) })
    const r = await handleInteraction(sub('mine'), deps)
    expect(r.data?.embeds?.[0].description).toMatch(/Slow down/)
    expect(b.defer).not.toHaveBeenCalled()
  })

  describe('autocomplete', () => {
    it.each([
      ['list', 'crew', 'crew'],
      ['claim', 'bounty', 'claim'],
      ['giveup', 'bounty', 'giveup'],
    ])('%s.%s asks for %s choices', async (s, o, kind) => {
      const { deps, b } = make()
      const r = await handleInteraction(sub(s, [{ name: o, type: o === 'crew' ? 3 : 4, value: 'q', focused: true }], 4), deps)
      expect(r.type).toBe(8)
      expect(r.data?.choices).toEqual([{ name: '#1 · 5 $PEP · x', value: 1 }])
      expect(b.choices).toHaveBeenCalledWith(kind, ME, 'q')
    })

    it('returns no choices while disabled, and no lookup', async () => {
      const { deps, b } = make({ enabled: false })
      const r = await handleInteraction(sub('claim', [{ name: 'bounty', type: 4, value: '', focused: true }], 4), deps)
      expect(r.data?.choices).toEqual([])
      expect(b.choices).not.toHaveBeenCalled()
    })

    it('caps the choices at 25', async () => {
      const { deps, b } = make()
      b.choices.mockResolvedValueOnce(Array.from({ length: 40 }, (_, i) => ({ name: `#${i}`, value: i })))
      const r = await handleInteraction(sub('claim', [{ name: 'bounty', type: 4, value: '', focused: true }], 4), deps)
      expect(r.data?.choices).toHaveLength(25)
    })
  })
})
