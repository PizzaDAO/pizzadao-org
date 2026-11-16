// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')

import { prisma } from '@/app/lib/db'
import { ACTION_KEY_RE, assignActionKeys, ensureActionKeys, fillMissingKeys, newActionKey, textSimilarity } from './action-keys'
import { carryDone } from './recordings'

describe('assignActionKeys', () => {
  const prev = [
    { text: 'Send the deck to the venue', owner: 'Ann', key: 'aaaaaaaa' },
    { text: 'Book the room', owner: 'Bob', key: 'bbbbbbbb' },
    { text: 'Book the room', owner: 'Cy', key: 'cccccccc' },
  ]

  it('makes well-formed keys', () => {
    expect(newActionKey()).toMatch(ACTION_KEY_RE)
    const out = assignActionKeys([], [{ text: 'A' }, { text: 'B' }])
    expect(out.map((o) => o.key)).toSatisfy((k: string[]) => k.every((x) => ACTION_KEY_RE.test(x)) && new Set(k).size === 2)
  })

  it('keeps a key the previous list had', () => {
    const out = assignActionKeys(prev, [{ text: 'Totally different words', owner: 'Ann', key: 'bbbbbbbb' }])
    expect(out[0].key).toBe('bbbbbbbb')
  })

  it('replaces a key the previous list never had (a forged key links nothing)', () => {
    const out = assignActionKeys(prev, [{ text: 'Something new', key: 'zzzzzzzz' }])
    expect(out[0].key).not.toBe('zzzzzzzz')
    expect(out[0].key).toMatch(ACTION_KEY_RE)
  })

  it('does not hand the same key to two items', () => {
    const out = assignActionKeys(prev, [{ text: 'A', key: 'aaaaaaaa' }, { text: 'B', key: 'aaaaaaaa' }])
    expect(out[0].key).toBe('aaaaaaaa')
    expect(out[1].key).not.toBe('aaaaaaaa')
  })

  it('matches unchanged text (case and spacing insensitive), also after a reorder', () => {
    const out = assignActionKeys(prev, [{ text: 'book  THE room', owner: 'Bob' }, { text: 'send the deck to the venue' }])
    expect(out[0].key).toBe('bbbbbbbb')
    expect(out[1].key).toBe('aaaaaaaa')
  })

  it('duplicate texts take the previous keys in order, once each', () => {
    const out = assignActionKeys(prev, [{ text: 'Book the room' }, { text: 'Book the room' }, { text: 'Book the room' }])
    expect(out[0].key).toBe('bbbbbbbb')
    expect(out[1].key).toBe('cccccccc')
    expect(new Set([out[0].key, out[1].key, out[2].key]).size).toBe(3)
  })

  it('a light rewording at the same position and owner keeps the key', () => {
    const out = assignActionKeys(prev, [{ text: 'Send the deck to the venue manager', owner: 'Ann' }])
    expect(out[0].key).toBe('aaaaaaaa')
  })

  it('a rewording by a different owner, or a different text, gets a new key', () => {
    expect(assignActionKeys(prev, [{ text: 'Send the deck to the venue manager', owner: 'Dee' }])[0].key).not.toBe('aaaaaaaa')
    expect(assignActionKeys(prev, [{ text: 'Plan the party', owner: 'Ann' }])[0].key).not.toBe('aaaaaaaa')
  })

  it('works when there is no previous list, and ignores junk in it', () => {
    expect(assignActionKeys(null, [{ text: 'A' }])[0].key).toMatch(ACTION_KEY_RE)
    expect(assignActionKeys([null, 5, { text: 'A', key: 'bad key' }], [{ text: 'A' }])[0].key).toMatch(ACTION_KEY_RE)
  })

  it('composes with carryDone: done and key both survive a regeneration with unchanged text', () => {
    const before = [{ text: 'Ship it', owner: 'Ann', key: 'kkkkkkkk', done: true, evidence: [{ url: 'https://example.org/x' }] }]
    const out = assignActionKeys(before, carryDone(before, [{ text: 'ship it', owner: 'Ann' }]))
    expect(out[0]).toMatchObject({ key: 'kkkkkkkk', done: true })
  })

  it('text similarity is a token Jaccard', () => {
    expect(textSimilarity('a b c d', 'a b c d')).toBe(1)
    expect(textSimilarity('a b', 'c d')).toBe(0)
    expect(textSimilarity('', 'a')).toBe(0)
  })
})

describe('fillMissingKeys', () => {
  it('keeps valid unique keys, replaces duplicates and bad ones, and reports a change', () => {
    const { items, changed } = fillMissingKeys([{ text: 'A', key: 'aaaaaaaa' }, { text: 'B', key: 'aaaaaaaa' }, { text: 'C' }, { text: 'D', key: 'x' }])
    expect(changed).toBe(true)
    expect(items[0].key).toBe('aaaaaaaa')
    expect(new Set(items.map((i) => i.key)).size).toBe(4)
  })
  it('reports no change when every item has a key', () => {
    expect(fillMissingKeys([{ text: 'A', key: 'aaaaaaaa' }]).changed).toBe(false)
  })
})

describe('ensureActionKeys', () => {
  const tx = { $executeRaw: vi.fn(), callRecording: { findUnique: vi.fn(), update: vi.fn() } }
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (t: unknown) => unknown) => fn(tx)) as never)
  })

  it('writes keys for items that have none, under the per-call lock', async () => {
    tx.callRecording.findUnique.mockResolvedValue({ actionItems: [{ text: 'A', owner: 'Ann' }, { text: 'B', key: 'bbbbbbbb' }] })
    const out = await ensureActionKeys('rec1')
    expect(tx.$executeRaw).toHaveBeenCalled()
    expect(out.map((o) => o.text)).toEqual(['A', 'B'])
    expect(out[1].key).toBe('bbbbbbbb')
    const written = tx.callRecording.update.mock.calls[0][0].data.actionItems as Array<{ key: string; text: string }>
    expect(written.map((w) => w.key)).toEqual(out.map((o) => o.key))
  })

  it('writes nothing when all items already have keys, and nothing for a missing call', async () => {
    tx.callRecording.findUnique.mockResolvedValue({ actionItems: [{ text: 'A', key: 'aaaaaaaa' }] })
    expect(await ensureActionKeys('rec1')).toEqual([{ key: 'aaaaaaaa', text: 'A' }])
    expect(tx.callRecording.update).not.toHaveBeenCalled()
    tx.callRecording.findUnique.mockResolvedValue(null)
    expect(await ensureActionKeys('rec1')).toEqual([])
  })
})
