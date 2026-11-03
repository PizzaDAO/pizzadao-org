// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { handleInteraction, type HandlerDeps } from '../handle'
import { PEP_COMMANDS } from '../commands'

const GUILD = '812097286003359764'
const USER = '100000000000000001'
const CHANNEL = '900000000000000001'

function make(progress?: Partial<NonNullable<HandlerDeps['progress']>> | null) {
  const p = {
    enabled: vi.fn(async () => true),
    rateLimit: vi.fn(async () => null as Date | null),
    defer: vi.fn(),
    crewChoices: vi.fn(async () => [{ name: 'Ops Crew', value: 'ops' }]),
    ...progress,
  }
  const deps = { guildId: GUILD, ...(progress === null ? {} : { progress: p }) } as unknown as HandlerDeps
  return { deps, p }
}

const run = (options?: Array<{ name: string; type: number; value: unknown; focused?: boolean }>, over: Record<string, unknown> = {}, type = 2) => ({
  type,
  guild_id: GUILD,
  channel_id: CHANNEL,
  application_id: 'app1',
  token: 'tok',
  member: { user: { id: USER, username: 'snax' }, roles: [] },
  data: { name: 'progress', options },
  ...over,
})

describe('/progress', () => {
  it('is registered with an optional crew option with autocomplete', () => {
    const c = PEP_COMMANDS.find((x) => x.name === 'progress')
    expect(c).toBeTruthy()
    expect(c?.options?.[0]).toMatchObject({ name: 'crew', required: false, autocomplete: true })
  })

  it('answers "not enabled" while the setting is off, without using the rate limit or deferring', async () => {
    const { deps, p } = make({ enabled: vi.fn(async () => false) })
    const r = await handleInteraction(run(), deps)
    expect(r.data?.embeds?.[0].description).toMatch(/isn't enabled/)
    expect(r.data?.flags).toBe(64)
    expect(p.rateLimit).not.toHaveBeenCalled()
    expect(p.defer).not.toHaveBeenCalled()
  })

  it('answers "not enabled" when the route wires nothing', async () => {
    const { deps } = make(null)
    expect((await handleInteraction(run(), deps)).data?.embeds?.[0].description).toMatch(/isn't enabled/)
  })

  it('on: defers a PUBLIC reply and hands the job over', async () => {
    const { deps, p } = make()
    const r = await handleInteraction(run([{ name: 'crew', type: 3, value: ' ops ' }]), deps)
    expect(r.type).toBe(5)
    expect(r.data?.flags).toBeUndefined() // not ephemeral
    expect(p.rateLimit).toHaveBeenCalledWith(CHANNEL)
    expect(p.defer).toHaveBeenCalledWith(expect.objectContaining({ applicationId: 'app1', token: 'tok', crew: 'ops' }))
  })

  it('on without a crew option: the job carries none', async () => {
    const { deps, p } = make()
    await handleInteraction(run(), deps)
    expect(p.defer.mock.calls[0][0]).not.toHaveProperty('crew')
  })

  it('rate limited per channel: ephemeral wait, no deferral', async () => {
    const { deps, p } = make({ rateLimit: vi.fn(async () => new Date(Date.now() + 60_000)) })
    const r = await handleInteraction(run(), deps)
    expect(r.type).toBe(4)
    expect(r.data?.flags).toBe(64)
    expect(p.defer).not.toHaveBeenCalled()
  })

  it('refuses outside the guild', async () => {
    const { deps, p } = make()
    const r = await handleInteraction(run(undefined, { guild_id: 'other' }), deps)
    expect(r.data?.embeds?.[0].description).toMatch(/only work in the PizzaDAO server/)
    expect(p.defer).not.toHaveBeenCalled()
  })

  it('autocomplete lists crews only while enabled', async () => {
    const opts = [{ name: 'crew', type: 3, value: 'op', focused: true }]
    const on = make()
    expect((await handleInteraction(run(opts, {}, 4), on.deps)).data?.choices).toEqual([{ name: 'Ops Crew', value: 'ops' }])
    expect(on.p.crewChoices).toHaveBeenCalledWith('op')
    const off = make({ enabled: vi.fn(async () => false) })
    expect((await handleInteraction(run(opts, {}, 4), off.deps)).data?.choices).toEqual([])
  })
})
