// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { handleInteraction, type HandlerDeps } from '../handle'
import { PEP_COMMANDS } from '../commands'

const GUILD = '812097286003359764'

function make(over: Partial<NonNullable<HandlerDeps['live']>> | null = {}) {
  const l = { enabled: vi.fn(async () => true), canRun: vi.fn(async () => true), defer: vi.fn(), ...over }
  return { deps: { guildId: GUILD, ...(over === null ? {} : { live: l }) } as unknown as HandlerDeps, l }
}

const run = (options?: Array<{ name: string; type: number; value: unknown }>, roles: string[] = ['1']) => ({
  type: 2,
  guild_id: GUILD,
  channel_id: '9',
  application_id: 'app1',
  token: 'tok',
  member: { user: { id: '100000000000000001', username: 'h' }, roles },
  data: { name: 'live', options },
})

describe('/live', () => {
  it('is registered with an optional stream option', () => {
    const c = (PEP_COMMANDS as readonly { name: string; options?: readonly unknown[] }[]).find((x) => x.name === 'live')
    expect(c?.options?.[0]).toMatchObject({ name: 'stream', required: false })
  })

  it('answers "not enabled" while off or unwired, without checking roles or deferring', async () => {
    const off = make({ enabled: vi.fn(async () => false) })
    expect((await handleInteraction(run(), off.deps)).data?.embeds?.[0].description).toMatch(/isn't enabled/)
    expect(off.l.canRun).not.toHaveBeenCalled()
    expect((await handleInteraction(run(), make(null).deps)).data?.embeds?.[0].description).toMatch(/isn't enabled/)
  })

  it('refuses members without a host or admin role', async () => {
    const { deps, l } = make({ canRun: vi.fn(async () => false) })
    const r = await handleInteraction(run(), deps)
    expect(r.data?.embeds?.[0].description).toMatch(/Only hosts and admins/)
    expect(l.defer).not.toHaveBeenCalled()
    expect(l.canRun).toHaveBeenCalledWith(['1'])
  })

  it('rejects a stream link that is not on x.com / twitter.com', async () => {
    const { deps, l } = make()
    const r = await handleInteraction(run([{ name: 'stream', type: 3, value: 'https://youtube.com/watch?v=1' }]), deps)
    expect(r.data?.embeds?.[0].description).toMatch(/x\.com or twitter\.com/)
    expect(l.defer).not.toHaveBeenCalled()
  })

  it('on: defers an EPHEMERAL reply and hands over the normalized stream link', async () => {
    const { deps, l } = make()
    const r = await handleInteraction(run([{ name: 'stream', type: 3, value: ' https://twitter.com/i/broadcasts/abc ' }]), deps)
    expect(r.type).toBe(5)
    expect(r.data?.flags).toBe(64)
    expect(l.defer).toHaveBeenCalledWith(expect.objectContaining({ applicationId: 'app1', token: 'tok', stream: 'https://twitter.com/i/broadcasts/abc' }))
  })

  it('with no stream option: shows the modal (type 9) after the enabled and role checks, defers nothing', async () => {
    const { deps, l } = make()
    const r = await handleInteraction(run(), deps)
    expect(r.type).toBe(9)
    expect(r.data?.custom_id).toBe('live:stream')
    expect(JSON.stringify(r.data?.components)).toMatch(/X stream link/)
    expect(l.canRun).toHaveBeenCalledWith(['1'])
    expect(l.defer).not.toHaveBeenCalled()
  })

  it('no modal for a member who may not run /live', async () => {
    const { deps } = make({ canRun: vi.fn(async () => false) })
    expect((await handleInteraction(run(), deps)).type).toBe(4)
  })

  describe('modal submit', () => {
    const submit = (value: string | undefined, roles: string[] = ['1']) => ({
      ...run(undefined, roles),
      type: 5,
      data: { custom_id: 'live:stream', components: [{ type: 1, components: [{ type: 4, custom_id: 'stream', value }] }] },
    })

    it('valid link: defers an ephemeral reply with the normalized link', async () => {
      const { deps, l } = make()
      const r = await handleInteraction(submit(' https://x.com/i/broadcasts/abc '), deps)
      expect(r.type).toBe(5)
      expect(r.data?.flags).toBe(64)
      expect(l.defer).toHaveBeenCalledWith(expect.objectContaining({ applicationId: 'app1', token: 'tok', stream: 'https://x.com/i/broadcasts/abc' }))
    })

    it('blank: announces without a link', async () => {
      const { deps, l } = make()
      expect((await handleInteraction(submit('  '), deps)).type).toBe(5)
      expect(l.defer).toHaveBeenCalledWith(expect.not.objectContaining({ stream: expect.anything() }))
    })

    it('invalid link: ephemeral error, nothing deferred', async () => {
      const { deps, l } = make()
      const r = await handleInteraction(submit('https://youtube.com/watch?v=1'), deps)
      expect(r.data?.embeds?.[0].description).toMatch(/x\.com or twitter\.com/)
      expect(l.defer).not.toHaveBeenCalled()
    })

    it('enforces the role check and the toggle again on submit', async () => {
      const denied = make({ canRun: vi.fn(async () => false) })
      expect((await handleInteraction(submit('https://x.com/a/status/1'), denied.deps)).data?.embeds?.[0].description).toMatch(/Only hosts and admins/)
      expect(denied.l.defer).not.toHaveBeenCalled()
      const off = make({ enabled: vi.fn(async () => false) })
      expect((await handleInteraction(submit(undefined), off.deps)).data?.embeds?.[0].description).toMatch(/isn't enabled/)
      expect(off.l.defer).not.toHaveBeenCalled()
    })
  })
})
