import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn(async () => ({ discordId: 'user-1' })) }))
vi.mock('@/app/lib/jobs', () => ({
  getDailyJobs: vi.fn(async () => ({
    jobs: [{ id: 1, description: 'Post in <#123456789012345678>', type: 'content_creation', assignees: ['someone'] }],
    resetAt: new Date('2026-01-02T00:00:00Z'),
  })),
  getCompletedJobsToday: vi.fn(async () => []),
  getJobRewardAmount: vi.fn(async () => 50),
}))
vi.mock('@/app/lib/discord-mention-resolve', () => ({
  resolveDiscordMentions: vi.fn(async () => ({ channels: { '123456789012345678': 'general' }, roles: {}, users: {}, guildId: '999' })),
}))

import { GET } from './route'

describe('GET /api/jobs', () => {
  it('does not expose who completed a job (no assignees key) and returns resolved channel names', async () => {
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.jobs).toHaveLength(1)
    expect(body.jobs[0]).not.toHaveProperty('assignees')
    expect(body.jobs[0]).toMatchObject({ id: 1, type: 'content_creation', completed: false })
    expect(body.channels).toEqual({ '123456789012345678': 'general' })
  })
})
