// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { handleInteraction, type HandlerDeps } from '../handle'
import { PEP_COMMANDS } from '../commands'
import { buildTaskReply, renderList, runTaskCommand, type TaskDeps, type TaskJob, type TaskRow } from '../task-command'
import type { ClaimResult } from '@/app/lib/crews/claim-task'
import { TOGGLES } from '@/app/lib/settings/toggles'

const GUILD = '812097286003359764'
const ME = '100000000000000001'
const APP = 'https://app.example.org'
const TID = 'cm1abcdefghijklmnopqrstuv'

describe('registration', () => {
  type Opt = { type: number; name: string; description: string; options?: readonly Opt[]; max_length?: number }
  const task = (PEP_COMMANDS as readonly { name: string; description: string; options?: readonly Opt[]; dm_permission?: boolean }[]).find((c) => c.name === 'task')!

  it('has list / claim / mine / drop, guild only', () => {
    expect(task.options?.map((o) => o.name)).toEqual(['list', 'claim', 'mine', 'drop'])
    expect(task.dm_permission).toBe(false)
    expect(task.options?.find((o) => o.name === 'claim')?.options?.[0]).toMatchObject({ name: 'task', type: 3, required: true, autocomplete: true, max_length: 100 })
    expect(task.options?.find((o) => o.name === 'list')?.options?.[0]).toMatchObject({ name: 'crew', type: 3, required: false, autocomplete: true })
  })

  it('stays inside Discord limits', () => {
    const walk = (o: { name: string; description: string; options?: readonly Opt[] }) => {
      expect(o.name.length).toBeLessThanOrEqual(32)
      expect(o.description.length).toBeLessThanOrEqual(100)
      o.options?.forEach(walk)
    }
    walk(task)
  })

  it('/bounty is not registered', () => {
    expect(PEP_COMMANDS.map((c) => c.name)).not.toContain('bounty')
  })

  it('the toggle is wired to its env var', () => {
    expect(TOGGLES['discord.taskCommandEnabled'].env).toBe('TASK_COMMAND_ENABLED')
  })
})

const row = (n: number, over: Partial<TaskRow> = {}): TaskRow => ({ id: `id${n}`, label: `Do thing ${n}`, crewId: 'ops', stage: 'todo', priority: null, due: null, ...over })
const labels = new Map([['ops', 'Ops Crew']])

describe('renderers', () => {
  it('lines read Crew · label · Top · due Nov 30, leaving out empty parts', () => {
    const e = renderList([row(1, { priority: 'Top', due: '2026-11-30' }), row(2)], APP, labels)
    expect(e.description).toContain('Ops Crew · Do thing 1 · Top · due Nov 30')
    expect(e.description).toMatch(/Ops Crew · Do thing 2\n/)
    expect(e.description).toContain('2 open tasks')
    expect(e.description).toContain('`/task claim`')
    expect(e.description).toContain('`/bounty list`')
    expect(e.description).toContain(`(<${APP}/crews>)`)
  })

  it('flattens, cuts by code points and escapes markdown and mentions in the label and crew', () => {
    const e = renderList([row(1, { label: 'line one\n\nline *two* @everyone' }), row(2, { label: '🍕'.repeat(200) })], APP, new Map([['ops', '*Ops* @here']]))
    const body = e.description!
    expect(body).toContain('\\*Ops\\* @​here · line one line \\*two\\* @​everyone')
    expect(body).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
    expect(body).toContain('🍕'.repeat(89) + '…')
  })

  it('caps at 10 with "N more on the website" and stays under 4,000 characters', () => {
    const e = renderList(Array.from({ length: 14 }, (_, i) => row(i + 1, { label: 'y'.repeat(300) })), APP, labels)
    expect(e.description!.match(/Ops Crew ·/g)).toHaveLength(10)
    expect(e.description).toContain('4 more on the website')
    expect(e.description!.length).toBeLessThan(4000)
  })

  it('links the crew page when filtered, and has an empty state', () => {
    expect(renderList([row(1)], APP, labels, 'ops').description).toContain(`(<${APP}/crew/ops#tasks>)`)
    const empty = renderList([], APP, labels, 'ops').description!
    expect(empty).toContain('No open tasks right now for Ops Crew.')
    expect(empty).toContain(`(<${APP}/crew/ops#tasks>)`)
  })
})

const job = (over: Partial<TaskJob> = {}): TaskJob => ({ sub: 'list', discordId: ME, applicationId: 'app1', token: 'tok', ...over })
const okClaim = (action: 'claim' | 'giveup'): ClaimResult => ({ ok: true, action, task: { id: TID, label: 'Bake bread', crewId: 'ops' } })
function makeDeps(over: Partial<TaskDeps> = {}) {
  return {
    openTasks: vi.fn(async () => [row(1), row(2)]),
    myTasks: vi.fn(async () => [] as TaskRow[]),
    claim: vi.fn(async () => okClaim('claim')),
    drop: vi.fn(async () => okClaim('giveup')),
    isMember: vi.fn(async () => true),
    crewLabels: vi.fn(async () => labels),
    appUrl: APP,
    ...over,
  }
}
const text = async (j: TaskJob, d: TaskDeps) => (await buildTaskReply(j, d)).description!
const refuse = (status: 400 | 403 | 404 | 409 | 500, error: string): ClaimResult => ({ ok: false, status, error })

describe('buildTaskReply', () => {
  it('a non-member is told to finish onboarding and nothing is called', async () => {
    const d = makeDeps({ isMember: vi.fn(async () => false) })
    for (const sub of ['list', 'claim', 'mine', 'drop'] as const) expect(await text(job({ sub, taskId: TID }), d)).toMatch(/Finish onboarding first/)
    expect(d.claim).not.toHaveBeenCalled()
    expect(d.drop).not.toHaveBeenCalled()
    expect(d.openTasks).not.toHaveBeenCalled()
  })

  it('list passes the crew filter through', async () => {
    const d = makeDeps()
    await buildTaskReply(job({ crewId: 'ops' }), d)
    expect(d.openTasks).toHaveBeenCalledWith('ops')
  })

  it('claim: "You\'re on it" with the crew page link', async () => {
    const d = makeDeps()
    const t = await text(job({ sub: 'claim', taskId: TID }), d)
    expect(t).toContain("You're on it: Bake bread (Ops Crew).")
    expect(t).toContain('give it up on the crew page')
    expect(t).toContain(`(<${APP}/crew/ops#tasks>)`)
    expect(d.claim).toHaveBeenCalledWith(ME, TID)
  })

  it.each([
    [409, 'Task is already claimed by another member', 'Someone else signed up for it, or it was closed.'],
    [409, 'That task is closed', 'That task is closed.'],
    [404, 'Task not found', "isn't available any more"],
    [403, 'No member profile is linked to your Discord account', 'No member profile is linked'],
  ])('claim maps %i %s', async (status, error, expected) => {
    const t = await text(job({ sub: 'claim', taskId: TID }), makeDeps({ claim: vi.fn(async () => refuse(status as 403, error)) }))
    expect(t).toContain(expected)
    expect(t).toMatch(/^❌/)
  })

  it('a 500 result throws, so the runner shows the generic reply', async () => {
    await expect(buildTaskReply(job({ sub: 'claim', taskId: TID }), makeDeps({ claim: vi.fn(async () => refuse(500, 'x')) }))).rejects.toThrow()
  })

  it('mine: empty, and with the stage', async () => {
    expect(await text(job({ sub: 'mine' }), makeDeps())).toMatch(/aren't leading any open tasks/)
    const d = makeDeps({ myTasks: vi.fn(async () => [row(4, { stage: 'Doing' })]) })
    const t = await text(job({ sub: 'mine' }), d)
    expect(t).toContain('Your tasks (1)')
    expect(t).toContain('Ops Crew · Do thing 4 · Doing')
    expect(d.myTasks).toHaveBeenCalledWith(ME)
  })

  it('drop succeeds, and says so when it is not yours', async () => {
    const d = makeDeps()
    expect(await text(job({ sub: 'drop', taskId: TID }), d)).toContain('You dropped Bake bread.')
    expect(d.drop).toHaveBeenCalledWith(ME, TID)
    const bad = makeDeps({ drop: vi.fn(async () => refuse(403, 'You can only give up tasks you lead')) })
    expect(await text(job({ sub: 'drop', taskId: TID }), bad)).toContain('You can only drop tasks you lead.')
  })
})

describe('runTaskCommand', () => {
  it('PATCHes @original once with no pings', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    await runTaskCommand(job(), makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://discord.com/api/v10/webhooks/app1/tok/messages/@original')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string).allowed_mentions).toEqual({ parse: [] })
  })

  it('falls back to the generic error reply when deps throw, and never throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    const d = makeDeps({ openTasks: vi.fn(async () => { throw new Error('boom') }), fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(runTaskCommand(job(), d)).resolves.toBeUndefined()
    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).embeds[0].description).toMatch(/Something went wrong/)
  })
})

// ---------------------------------------------------------------- handler ---

function make(over: { enabled?: boolean; readyAt?: Date | null } = {}) {
  const t = {
    enabled: vi.fn(async () => over.enabled ?? true),
    rateLimit: vi.fn(async () => over.readyAt ?? null),
    defer: vi.fn(),
    choices: vi.fn(async () => [{ name: 'Ops · x', value: TID }]),
  }
  return { deps: { guildId: GUILD, task: t } as unknown as HandlerDeps, t }
}
const sub = (name: string, options: Array<{ name: string; type: number; value?: unknown; focused?: boolean }> = [], type = 2) => ({
  type,
  guild_id: GUILD,
  application_id: 'app1',
  token: 'tok',
  member: { user: { id: ME, username: 'someone' }, roles: [] },
  data: { name: 'task', options: [{ name, type: 1, options }] },
})

describe('handler', () => {
  it('while off: "isn\'t enabled yet", ephemeral, no rate limit, no deferral', async () => {
    const { deps, t } = make({ enabled: false })
    const r = await handleInteraction(sub('list'), deps)
    expect(r.data?.embeds?.[0].description).toMatch(/isn't enabled yet/)
    expect(r.data?.flags).toBe(64)
    expect(t.rateLimit).not.toHaveBeenCalled()
    expect(t.defer).not.toHaveBeenCalled()
    expect((await handleInteraction(sub('list'), { guildId: GUILD } as unknown as HandlerDeps)).data?.embeds?.[0].description).toMatch(/isn't enabled yet/)
  })

  it('on: defers an EPHEMERAL reply with the right job', async () => {
    const { deps, t } = make()
    const r = await handleInteraction(sub('claim', [{ name: 'task', type: 3, value: TID }]), deps)
    expect(r).toMatchObject({ type: 5, data: { flags: 64 } })
    expect(t.defer).toHaveBeenCalledWith(expect.objectContaining({ sub: 'claim', discordId: ME, taskId: TID, applicationId: 'app1', token: 'tok' }))
    await handleInteraction(sub('list', [{ name: 'crew', type: 3, value: 'Ops' }]), deps)
    expect(t.defer).toHaveBeenLastCalledWith(expect.objectContaining({ sub: 'list', crewId: 'ops' }))
    await handleInteraction(sub('mine'), deps)
    expect(t.defer).toHaveBeenLastCalledWith(expect.objectContaining({ sub: 'mine' }))
    await handleInteraction(sub('drop', [{ name: 'task', type: 3, value: TID }]), deps)
    expect(t.defer).toHaveBeenLastCalledWith(expect.objectContaining({ sub: 'drop', taskId: TID }))
  })

  it('rejects a bad task or crew option before deferring', async () => {
    const { deps, t } = make()
    for (const value of ['abc', 'has space and is long enough 12345', 7, undefined]) {
      const r = await handleInteraction(sub('claim', value === undefined ? [] : [{ name: 'task', type: 3, value }]), deps)
      expect(r.data?.embeds?.[0].description).toMatch(/Pick a task from the list/)
    }
    expect((await handleInteraction(sub('list', [{ name: 'crew', type: 3, value: '!!!' }]), deps)).data?.embeds?.[0].description).toMatch(/Pick a crew/)
    expect(t.defer).not.toHaveBeenCalled()
  })

  it('an unknown subcommand is refused', async () => {
    const { deps, t } = make()
    expect((await handleInteraction(sub('giveup'), deps)).data?.embeds?.[0].description).toMatch(/Pick one of/)
    expect(t.defer).not.toHaveBeenCalled()
  })

  it('when rate limited: a wait message and no deferral', async () => {
    const { deps, t } = make({ readyAt: new Date(Date.now() + 30_000) })
    expect((await handleInteraction(sub('mine'), deps)).data?.embeds?.[0].description).toMatch(/Slow down/)
    expect(t.defer).not.toHaveBeenCalled()
  })

  describe('autocomplete', () => {
    it.each([
      ['list', 'crew', 'crew'],
      ['claim', 'task', 'claim'],
      ['drop', 'task', 'drop'],
    ])('%s.%s asks for %s choices', async (s, o, kind) => {
      const { deps, t } = make()
      const r = await handleInteraction(sub(s, [{ name: o, type: 3, value: 'q', focused: true }], 4), deps)
      expect(r.type).toBe(8)
      expect(r.data?.choices).toEqual([{ name: 'Ops · x', value: TID }])
      expect(t.choices).toHaveBeenCalledWith(kind, ME, 'q')
    })

    it('returns no choices while disabled, and no lookup', async () => {
      const { deps, t } = make({ enabled: false })
      const r = await handleInteraction(sub('claim', [{ name: 'task', type: 3, value: '', focused: true }], 4), deps)
      expect(r.data?.choices).toEqual([])
      expect(t.choices).not.toHaveBeenCalled()
    })

    it('caps the choices at 25', async () => {
      const { deps, t } = make()
      t.choices.mockResolvedValueOnce(Array.from({ length: 40 }, (_, i) => ({ name: `#${i}`, value: String(i) })))
      expect((await handleInteraction(sub('claim', [{ name: 'task', type: 3, value: '', focused: true }], 4), deps)).data?.choices).toHaveLength(25)
    })
  })
})
