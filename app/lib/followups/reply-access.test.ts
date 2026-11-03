// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/missions', () => ({ getCurrentLevel: vi.fn() }))
vi.mock('@/app/lib/mission-review-access', () => ({ isDreadPizzaRoberts: vi.fn() }))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn() }))
vi.mock('@/app/lib/db')
vi.mock('@/app/lib/sheets/members-list', () => ({ fetchAllMembers: vi.fn() }))

import { getCurrentLevel } from '@/app/lib/missions'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { getSetting } from '@/app/lib/settings'
import { canReadFollowUpReplies } from './reply-access'
import { hideReplyText } from './admin'

const level = vi.mocked(getCurrentLevel)
const dpr = vi.mocked(isDreadPizzaRoberts)
const setting = vi.mocked(getSetting)

describe('canReadFollowUpReplies', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    dpr.mockResolvedValue(false)
    setting.mockResolvedValue(7 as never)
  })
  it('reads followups.replyMinLevel', async () => {
    level.mockResolvedValue(7)
    await canReadFollowUpReplies('u')
    expect(setting).toHaveBeenCalledWith('followups.replyMinLevel')
  })
  it('allows level 7, denies level 6', async () => {
    level.mockResolvedValue(7)
    expect(await canReadFollowUpReplies('u')).toBe(true)
    level.mockResolvedValue(6)
    expect(await canReadFollowUpReplies('u')).toBe(false)
  })
  it('follows the setting', async () => {
    setting.mockResolvedValue(5 as never)
    level.mockResolvedValue(5)
    expect(await canReadFollowUpReplies('u')).toBe(true)
  })
  it('always allows Dread Pizza Roberts', async () => {
    level.mockResolvedValue(1)
    dpr.mockResolvedValue(true)
    expect(await canReadFollowUpReplies('u')).toBe(true)
  })
  it('fails closed on lookup errors and empty id', async () => {
    level.mockRejectedValue(new Error('db'))
    dpr.mockRejectedValue(new Error('discord'))
    expect(await canReadFollowUpReplies('u')).toBe(false)
    expect(await canReadFollowUpReplies('')).toBe(false)
  })
  it('fails closed when the setting is unreadable', async () => {
    level.mockResolvedValue(8)
    setting.mockRejectedValue(new Error('db'))
    expect(await canReadFollowUpReplies('u')).toBe(false)
  })
})

describe('hideReplyText', () => {
  const item = {
    lastReply: 'secret words',
    lastReplyAt: new Date('2026-11-02T10:00:00Z'),
    events: [
      { type: 'sent', data: { channel: 'DISCORD' } },
      { type: 'reply', data: { text: 'secret words', via: 'discord-dm' } },
      { type: 'inbound', data: { via: 'discord-dm' } },
    ],
  }
  it('strips the text but keeps time, channel and events', () => {
    const out = hideReplyText(item)
    expect(out.lastReply).toBeNull()
    expect(out.lastReplyAt).toEqual(item.lastReplyAt)
    expect(out.replyHidden).toBe(true)
    expect(out.events).toHaveLength(3)
    expect(out.events[1].data).toEqual({ via: 'discord-dm' })
    expect(JSON.stringify(out)).not.toContain('secret')
  })
  it('does not flag rows without a reply', () => {
    expect(hideReplyText({ lastReply: null, lastReplyAt: null, events: [] }).replyHidden).toBe(false)
  })
})
