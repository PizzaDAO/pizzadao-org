import { describe, it, expect, vi } from 'vitest'
import { handleInteraction, type HandlerDeps, type Interaction } from '../handle'
import type { FollowUpInteractionDeps } from '../followups'

const FU = 'c'.repeat(25)

const fu = (): FollowUpInteractionDeps & { notified: string[] } => {
  const notified: string[] = []
  return {
    notified,
    respond: vi.fn(async () => ({ ok: true as const, kind: 'status' as const, status: 'DONE' as const })),
    notify: (t: string) => void notified.push(t),
    owns: vi.fn(async () => true),
    canLink: vi.fn(async () => true),
    addLink: vi.fn(async () => ({ ok: true as const, kind: 'link' as const, status: 'DONE' as const })),
  }
}

const deps = (f?: FollowUpInteractionDeps): HandlerDeps => ({ guildId: 'g1', followups: f }) as unknown as HandlerDeps

// A DM interaction: no guild_id, the user is on `user` not `member`.
const dm = (customId: string, type = 3, extra: Partial<Interaction['data']> = {}): Interaction => ({
  type,
  user: { id: 'u1' },
  data: { custom_id: customId, ...extra },
})

describe('follow-up buttons in direct messages', () => {
  it('are handled even though a DM has no guild id', async () => {
    const f = fu()
    const res = await handleInteraction(dm(`fu:done:${FU}`), deps(f))
    expect(f.respond).toHaveBeenCalledWith({ followUpId: FU, discordId: 'u1', action: 'done' })
    expect(res.data?.content).toMatch(/done/i)
    expect(res.data?.flags).toBe(64)
  })
  it('other commands outside the guild are still refused', async () => {
    const res = await handleInteraction({ type: 2, user: { id: 'u1' }, data: { name: 'balance' } }, deps(fu()))
    expect(JSON.stringify(res)).toMatch(/only work in the PizzaDAO server/)
  })
  it('Reply opens a modal when the follow-up is theirs, and refuses otherwise', async () => {
    const f = fu()
    const res = await handleInteraction(dm(`fu:reply:${FU}`), deps(f))
    expect(res.type).toBe(9)
    expect(res.data?.custom_id).toBe(`fu:replymodal:${FU}`)
    vi.mocked(f.owns).mockResolvedValue(false)
    const no = await handleInteraction(dm(`fu:reply:${FU}`), deps(f))
    expect(no.type).toBe(4)
    expect(no.data?.content).toMatch(/not yours/i)
  })
  it('the modal submit records the reply and tells the approvers', async () => {
    const f = fu()
    vi.mocked(f.respond).mockResolvedValue({ ok: true, kind: 'reply', status: 'REPLIED', notify: 'Reply from Member A' })
    const submit = dm(`fu:replymodal:${FU}`, 5, { components: [{ type: 1, components: [{ type: 4, custom_id: 'fu:reply-input', value: 'on it' }] }] })
    const res = await handleInteraction(submit, deps(f))
    expect(f.respond).toHaveBeenCalledWith({ followUpId: FU, discordId: 'u1', action: 'reply', text: 'on it' })
    expect(f.notified).toEqual(['Reply from Member A'])
    expect(res.data?.content).toMatch(/passed it on/i)
  })
  it('Done stays one tap and the answer offers an optional "Add a link" button (in the user\'s language)', async () => {
    const f = fu()
    const en = await handleInteraction(dm(`fu:done:${FU}`), deps(f))
    expect(JSON.stringify(en.data?.components)).toContain(`fu:link:${FU}`)
    const fr = await handleInteraction({ ...dm(`fu:done:${FU}`), locale: 'fr' }, deps(f))
    expect(JSON.stringify(fr.data?.components)).toContain('Ajouter un lien')
    // On it / Need help carry no link button.
    const wip = await handleInteraction(dm(`fu:wip:${FU}`), deps(f))
    expect(wip.data?.components).toBeUndefined()
  })
  it('with links off (or no action item) Done answers exactly as before: no button, and the link paths are closed', async () => {
    const f = fu()
    vi.mocked(f.canLink).mockResolvedValue(false)
    const done = await handleInteraction(dm(`fu:done:${FU}`), deps(f))
    expect(done.data?.components).toBeUndefined()
    expect(done.data?.content).toBe('Marked as done. Thanks!')
    const open = await handleInteraction(dm(`fu:link:${FU}`), deps(f))
    expect(open.type).toBe(4)
    expect(open.data?.content).toMatch(/closed/i)
  })
  it('Add a link opens a one-field modal when the follow-up is theirs, and refuses otherwise', async () => {
    const f = fu()
    const res = await handleInteraction(dm(`fu:link:${FU}`), deps(f))
    expect(res.type).toBe(9)
    expect(res.data?.custom_id).toBe(`fu:linkmodal:${FU}`)
    expect(JSON.stringify(res.data?.components)).toContain('fu:link-input')
    vi.mocked(f.owns).mockResolvedValue(false)
    const no = await handleInteraction(dm(`fu:link:${FU}`), deps(f))
    expect(no.type).toBe(4)
    expect(no.data?.content).toMatch(/not yours/i)
  })
  it('the link modal submit stores the link and tells the approvers', async () => {
    const f = fu()
    vi.mocked(f.addLink).mockResolvedValue({ ok: true, kind: 'link', status: 'DONE', notify: 'Member A added a link' })
    const submit = dm(`fu:linkmodal:${FU}`, 5, { components: [{ type: 1, components: [{ type: 4, custom_id: 'fu:link-input', value: 'https://example.org/work' }] }] })
    const res = await handleInteraction(submit, deps(f))
    expect(f.addLink).toHaveBeenCalledWith({ followUpId: FU, discordId: 'u1', url: 'https://example.org/work' })
    expect(f.notified).toEqual(['Member A added a link'])
    expect(res.data?.content).toBe('Thanks, the link was added.')
    expect(res.data?.flags).toBe(64)
  })
  it('a bad link is answered with a plain message', async () => {
    const f = fu()
    vi.mocked(f.addLink).mockResolvedValue({ ok: false, reason: 'bad-url' })
    const res = await handleInteraction(dm(`fu:linkmodal:${FU}`, 5, { components: [{ type: 1, components: [{ type: 4, custom_id: 'fu:link-input', value: 'javascript:alert(1)' }] }] }), deps(f))
    expect(res.data?.content).toMatch(/valid web link/i)
    expect(f.notified).toEqual([])
  })
  it('Stop is acknowledged', async () => {
    const f = fu()
    vi.mocked(f.respond).mockResolvedValue({ ok: true, kind: 'stopped', status: 'SENT' })
    const res = await handleInteraction(dm(`fu:stop:${FU}`), deps(f))
    expect(res.data?.content).toMatch(/will not get/i)
  })
  it('a refusal from the action layer is shown as-is', async () => {
    const f = fu()
    vi.mocked(f.respond).mockResolvedValue({ ok: false, reason: 'not-yours' })
    const res = await handleInteraction(dm(`fu:done:${FU}`), deps(f))
    expect(res.data?.content).toMatch(/not yours/i)
  })
  it('malformed ids are rejected without calling anything', async () => {
    const f = fu()
    const res = await handleInteraction(dm('fu:done:short'), deps(f))
    expect(f.respond).not.toHaveBeenCalled()
    expect(res.data?.content).toMatch(/unknown/i)
  })
  it('an error inside the handler is a friendly message, not a crash', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = fu()
    vi.mocked(f.respond).mockRejectedValue(new Error('db down'))
    const res = await handleInteraction(dm(`fu:done:${FU}`), deps(f))
    expect(JSON.stringify(res)).toMatch(/Something went wrong/)
  })
})
