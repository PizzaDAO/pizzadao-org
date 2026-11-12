import { describe, it, expect, vi } from 'vitest'
import { handleInteraction, type HandlerDeps, type Interaction } from '../handle'
import type { ReminderInteractionDeps } from '../reminders'

const rm = (): ReminderInteractionDeps => ({ stop: vi.fn(async () => undefined), settingsUrl: vi.fn(async () => 'https://example.test/profile/1/edit') })
const deps = (r?: ReminderInteractionDeps): HandlerDeps => ({ guildId: 'g1', reminders: r }) as unknown as HandlerDeps
const dm = (customId: string, extra: Partial<Interaction> = {}): Interaction => ({ type: 3, user: { id: 'u1' }, data: { custom_id: customId }, ...extra })

describe('rm: Stop button on reminder DMs', () => {
  it('turns call reminders off for the invoking user, from a DM (no guild id)', async () => {
    const r = rm()
    const res = await handleInteraction(dm('rm:stop:calls'), deps(r))
    expect(r.stop).toHaveBeenCalledWith('u1', 'calls')
    expect(res.data?.content).toMatch(/not get call reminders/i)
    expect(res.data?.flags).toBe(64)
  })
  it('rm:stop:proposals turns proposal reminders off for the invoking user only', async () => {
    const r = rm()
    const res = await handleInteraction(dm('rm:stop:proposals'), deps(r))
    expect(r.stop).toHaveBeenCalledWith('u1', 'proposals')
    expect(res.data?.content).toMatch(/not get proposal reminders/i)
    expect(res.data?.flags).toBe(64)
    expect((await handleInteraction(dm('rm:stop:proposals:u9'), deps(r))).data?.content).toMatch(/unknown/i)
  })
  it('the actor is member.user.id when present, never anything from the custom id', async () => {
    const r = rm()
    await handleInteraction(dm('rm:stop:calls', { user: undefined, member: { user: { id: 'u2' } } } as Partial<Interaction>), deps(r))
    expect(r.stop).toHaveBeenCalledWith('u2', 'calls')
  })
  it('refuses unknown actions, other kinds of interaction, and a missing user', async () => {
    const r = rm()
    expect((await handleInteraction(dm('rm:stop:calls:u9'), deps(r))).data?.content).toMatch(/unknown/i)
    expect((await handleInteraction(dm('rm:stop:other'), deps(r))).data?.content).toMatch(/unknown/i)
    expect(r.stop).not.toHaveBeenCalled()
    const none = await handleInteraction({ type: 3, data: { custom_id: 'rm:stop:calls' } }, deps(r))
    expect(JSON.stringify(none)).toMatch(/identify/i)
    expect(r.stop).not.toHaveBeenCalled()
  })
  it('answers "Unknown button" when reminders are not wired', async () => {
    expect(JSON.stringify(await handleInteraction(dm('rm:stop:calls'), deps()))).toMatch(/Unknown button/)
  })
  it('an error in the stop is reported without throwing', async () => {
    const r = rm()
    vi.mocked(r.stop).mockRejectedValue(new Error('db'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(JSON.stringify(await handleInteraction(dm('rm:stop:calls'), deps(r)))).toMatch(/went wrong/)
    spy.mockRestore()
  })
})
