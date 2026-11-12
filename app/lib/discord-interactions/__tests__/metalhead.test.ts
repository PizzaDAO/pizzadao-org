// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { handleInteraction, type HandlerDeps } from '../handle'
import { PEP_COMMANDS } from '../commands'

const GUILD = '812097286003359764'
const USER = '100000000000000001'
const CHANNEL = '900000000000000001'

function make(metalhead?: Partial<NonNullable<HandlerDeps['metalhead']>> | null, admin = false) {
  const m = {
    enabled: vi.fn(async () => true),
    rateLimit: vi.fn(async () => null as Date | null),
    defer: vi.fn(),
    callChoices: vi.fn(async () => [{ name: 'Ops', value: 's1' }]),
    ...metalhead,
  }
  const deps = { guildId: GUILD, isAdmin: vi.fn(async () => admin), ...(metalhead === null ? {} : { metalhead: m }) } as unknown as HandlerDeps
  return { deps, m }
}

type Opt = { name: string; type: number; value?: unknown; focused?: boolean; options?: Opt[] }
const run = (sub: string, subOptions?: Opt[], over: Record<string, unknown> = {}, type = 2) => ({
  type,
  guild_id: GUILD,
  channel_id: CHANNEL,
  application_id: 'app1',
  token: 'tok',
  member: { user: { id: USER, username: 'snax', global_name: 'Snax' }, roles: ['r1'] },
  data: { name: 'metalhead', options: [{ name: sub, type: 1, options: subOptions }] },
  ...over,
})

describe('/metalhead', () => {
  it('is registered with the six subcommands, each with an optional call option', () => {
    const c = (PEP_COMMANDS as readonly { name: string; options?: readonly { name: string; type: number; options?: readonly unknown[] }[] }[]).find((x) => x.name === 'metalhead')
    expect(c?.options?.map((o) => o.name)).toEqual(['updates', 'stop', 'pause', 'resume', 'skip', 'script'])
    for (const o of c!.options!) {
      expect(o.type).toBe(1)
      expect(o.options?.[0]).toMatchObject({ name: 'call', required: false, autocomplete: true })
    }
  })

  it('answers "not enabled" while the setting is off: no rate limit use, no deferral', async () => {
    const { deps, m } = make({ enabled: vi.fn(async () => false) })
    const r = await handleInteraction(run('updates'), deps)
    expect(r.data?.embeds?.[0].description).toMatch(/isn't enabled/)
    expect(r.data?.flags).toBe(64)
    expect(m.rateLimit).not.toHaveBeenCalled()
    expect(m.defer).not.toHaveBeenCalled()
  })

  it('answers "not enabled" when the route wires nothing', async () => {
    const { deps } = make(null)
    expect((await handleInteraction(run('stop'), deps)).data?.embeds?.[0].description).toMatch(/isn't enabled/)
  })

  it.each(['updates', 'stop', 'pause', 'resume', 'skip', 'script'])('%s defers an EPHEMERAL reply with the job', async (sub) => {
    const { deps, m } = make()
    const r = await handleInteraction(run(sub), deps)
    expect(r.type).toBe(5)
    expect(r.data?.flags).toBe(64)
    expect(m.rateLimit).toHaveBeenCalledWith(USER)
    expect(m.defer).toHaveBeenCalledWith(expect.objectContaining({ sub, discordId: USER, displayName: 'Snax', admin: false, channelId: CHANNEL, applicationId: 'app1', token: 'tok' }))
    expect((m.defer as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toHaveProperty('call')
  })

  it('carries the call choice and the admin flag', async () => {
    const { deps, m } = make(undefined, true)
    await handleInteraction(run('updates', [{ name: 'call', type: 3, value: ' s1 ' }]), deps)
    expect(m.defer).toHaveBeenCalledWith(expect.objectContaining({ call: 's1', admin: true }))
  })

  it('an unknown subcommand is refused', async () => {
    const { deps, m } = make()
    const r = await handleInteraction(run('stop-recording'), deps)
    expect(r.data?.embeds?.[0].description).toMatch(/Pick one of/)
    expect(m.defer).not.toHaveBeenCalled()
  })

  it('rate limited per member: ephemeral wait, no deferral', async () => {
    const { deps, m } = make({ rateLimit: vi.fn(async () => new Date(Date.now() + 60_000)) })
    const r = await handleInteraction(run('stop'), deps)
    expect(r.type).toBe(4)
    expect(r.data?.flags).toBe(64)
    expect(m.defer).not.toHaveBeenCalled()
  })

  it('refuses outside the guild', async () => {
    const { deps, m } = make()
    const r = await handleInteraction(run('stop', undefined, { guild_id: 'other' }), deps)
    expect(r.data?.embeds?.[0].description).toMatch(/only work in the PizzaDAO server/)
    expect(m.defer).not.toHaveBeenCalled()
  })

  it('autocompletes the call option with the live calls', async () => {
    const { deps, m } = make()
    const r = await handleInteraction(run('stop', [{ name: 'call', type: 3, value: 'o', focused: true }], {}, 4), deps)
    expect(r.type).toBe(8)
    expect(r.data?.choices).toEqual([{ name: 'Ops', value: 's1' }])
    expect(m.callChoices).toHaveBeenCalled()
  })

  it('autocomplete gives nothing while disabled', async () => {
    const { deps } = make({ enabled: vi.fn(async () => false) })
    const r = await handleInteraction(run('stop', [{ name: 'call', type: 3, value: 'o', focused: true }], {}, 4), deps)
    expect(r.data?.choices).toEqual([])
  })
})
