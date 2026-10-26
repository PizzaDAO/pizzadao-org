import { describe, expect, it } from 'vitest'
import { chatMessages, MAX_CHAT_MESSAGES } from './manifest.js'
import type { ManifestRecord } from './types.js'

const c = (messageId: string, atMs: number, text = 't', userId = '1'): ManifestRecord => ({ t: 'chat', messageId, userId, displayName: 'Ann', text, atMs })

describe('chatMessages', () => {
  it('orders by time, applies edits and deletes', () => {
    const out = chatMessages([c('b', 200), c('a', 100, 'old'), { t: 'chat-edit', messageId: 'a', text: 'new' }, c('x', 150), { t: 'chat-delete', messageId: 'x' }])
    expect(out.map((m) => [m.messageId, m.text])).toEqual([['a', 'new'], ['b', 't']])
  })
  it('drops purged users and blank text, ignores edits of unknown messages', () => {
    const out = chatMessages([c('a', 1, 'x', '9'), { t: 'purge', userId: '9' }, c('b', 2, '   '), { t: 'chat-edit', messageId: 'zz', text: 'q' }, c('c', 3)])
    expect(out.map((m) => m.messageId)).toEqual(['c'])
  })
  it('caps the count', () => {
    const recs = Array.from({ length: MAX_CHAT_MESSAGES + 5 }, (_, i) => c(String(i), i))
    expect(chatMessages(recs)).toHaveLength(MAX_CHAT_MESSAGES)
  })
})
