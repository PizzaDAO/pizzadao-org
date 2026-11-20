// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { handleInteraction, type HandlerDeps } from '../handle'
import { PEP_COMMANDS } from '../commands'
import { readTriviaSuggestModal, triviaSuggestModal, triviaSuggestReply, TRIVIA_SUGGEST_MODAL_ID } from '../trivia-command'

const GUILD = '812097286003359764'
const USER = '100000000000000001'

const base = {
  guild_id: GUILD,
  channel_id: '900000000000000001',
  application_id: 'app1',
  token: 'tok',
  member: { user: { id: USER, username: 'snax', global_name: 'Snax' }, roles: ['r1'] },
}
const command = () => ({ ...base, type: 2, data: { name: 'trivia', options: [{ name: 'suggest', type: 1 }] } })
const submit = (values: Record<string, string>) => ({
  ...base,
  type: 5,
  data: { custom_id: TRIVIA_SUGGEST_MODAL_ID, components: Object.entries(values).map(([custom_id, value]) => ({ type: 1, components: [{ type: 4, custom_id, value }] })) },
})
const good = { question: 'Which bitcointalk user proposed the word satoshi?', answer: 'ribuck', aliases: '', source: 'https://bitcointalk.org/x', category: '' }

function make(over: Record<string, unknown> = {}) {
  const t = {
    enabled: vi.fn(async () => true),
    rateLimit: vi.fn(async () => null as Date | null),
    defer: vi.fn(),
    suggest: vi.fn(async () => ({ status: 'recorded' }) as { status: string }),
    ...over,
  }
  return { deps: { guildId: GUILD, isAdmin: vi.fn(async () => false), trivia: t } as unknown as HandlerDeps, t }
}

describe('/trivia suggest', () => {
  it('is a subcommand with no options (the form is a modal), and any member may use it', () => {
    const cmd = (PEP_COMMANDS as readonly { name: string; options?: readonly { name: string; options?: unknown[] }[] }[]).find((c) => c.name === 'trivia')!
    const sub = cmd.options?.find((o) => o.name === 'suggest')
    expect(sub).toBeDefined()
    expect(sub?.options).toBeUndefined()
  })

  it('the command opens the modal (type 9) and defers nothing', async () => {
    const { deps, t } = make()
    const r = await handleInteraction(command(), deps)
    expect(r.type).toBe(9)
    expect(r.data?.custom_id).toBe(TRIVIA_SUGGEST_MODAL_ID)
    expect(t.defer).not.toHaveBeenCalled()
    expect(t.suggest).not.toHaveBeenCalled()
  })

  it('is refused while trivia is off, and rate limited, before the modal opens', async () => {
    const off = make({ enabled: vi.fn(async () => false) })
    expect((await handleInteraction(command(), off.deps)).data?.embeds?.[0].description).toMatch(/isn't enabled/)
    const slow = make({ rateLimit: vi.fn(async () => new Date(Date.now() + 30_000)) })
    expect((await handleInteraction(command(), slow.deps)).data?.embeds?.[0].description).toMatch(/Slow down/)
  })

  it('the modal has the five inputs, inside Discord limits, with only the optional ones optional', () => {
    const m = triviaSuggestModal()
    expect(m.title.length).toBeLessThanOrEqual(45)
    const inputs = m.components.map((r) => r.components[0] as unknown as { custom_id: string; label: string; required: boolean; max_length: number; placeholder?: string })
    expect(inputs.map((c) => c.custom_id)).toEqual(['question', 'answer', 'aliases', 'source', 'category'])
    expect(inputs.map((c) => c.required)).toEqual([true, true, false, true, false])
    for (const c of inputs) {
      expect(c.label.length).toBeLessThanOrEqual(45)
      expect(c.max_length).toBeLessThanOrEqual(4000)
      expect((c.placeholder ?? '').length).toBeLessThanOrEqual(100)
    }
  })

  it('a submit stores the suggestion for the member and replies privately', async () => {
    const { deps, t } = make()
    const r = await handleInteraction(submit(good), deps)
    expect(t.suggest).toHaveBeenCalledWith(USER, good)
    expect(r.type).toBe(4)
    expect(r.data?.flags).toBe(64)
    expect(r.data?.embeds?.[0].description).toMatch(/Thanks/)
  })

  it('reports the daily limit and validation problems, and survives a storage failure', async () => {
    const limit = make({ suggest: vi.fn(async () => ({ status: 'limit' })) })
    expect((await handleInteraction(submit(good), limit.deps)).data?.embeds?.[0].description).toMatch(/5 questions a day/)
    const bad = make({ suggest: vi.fn(async () => ({ status: 'invalid', field: 'source' })) })
    expect((await handleInteraction(submit({ ...good, source: 'nope' }), bad.deps)).data?.embeds?.[0].description).toMatch(/http or https/)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom = make({
      suggest: vi.fn(async () => {
        throw new Error('db')
      }),
    })
    expect((await handleInteraction(submit(good), boom.deps)).data?.embeds?.[0].description).toMatch(/Something went wrong/)
  })

  it('a submit while trivia is off stores nothing', async () => {
    const { deps, t } = make({ enabled: vi.fn(async () => false) })
    const r = await handleInteraction(submit(good), deps)
    expect(r.data?.embeds?.[0].description).toMatch(/isn't enabled/)
    expect(t.suggest).not.toHaveBeenCalled()
  })

  it('reads missing inputs as empty text and explains a bad category', () => {
    expect(readTriviaSuggestModal(undefined)).toEqual({ question: '', answer: '', aliases: '', source: '', category: '' })
    expect(triviaSuggestReply({ status: 'invalid', field: 'category' }, 5)[2]).toMatch(/pizza-day/)
  })
})
