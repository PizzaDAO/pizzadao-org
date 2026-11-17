import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./sheets/member-repository', () => ({ fetchMemberIdByDiscordId: vi.fn() }))
vi.mock('./profile-summary-cache', () => ({ invalidateProfileSummary: vi.fn() }))

import { invalidateProfileSummaryForDiscord } from './profile-summary-invalidate'
import { fetchMemberIdByDiscordId } from './sheets/member-repository'
import { invalidateProfileSummary } from './profile-summary-cache'

beforeEach(() => vi.clearAllMocks())

describe('invalidateProfileSummaryForDiscord', () => {
  it('maps the Discord id to the member id and invalidates it', async () => {
    vi.mocked(fetchMemberIdByDiscordId).mockResolvedValue('42')
    await invalidateProfileSummaryForDiscord('d1')
    expect(invalidateProfileSummary).toHaveBeenCalledWith('42')
  })
  it('does nothing for an unknown or empty id', async () => {
    vi.mocked(fetchMemberIdByDiscordId).mockResolvedValue(null)
    await invalidateProfileSummaryForDiscord('d1')
    await invalidateProfileSummaryForDiscord('')
    expect(invalidateProfileSummary).not.toHaveBeenCalled()
  })
  it('never throws when the lookup or the invalidation fails', async () => {
    vi.mocked(fetchMemberIdByDiscordId).mockRejectedValue(new Error('sheet down'))
    await expect(invalidateProfileSummaryForDiscord('d1')).resolves.toBeUndefined()
    vi.mocked(fetchMemberIdByDiscordId).mockResolvedValue('42')
    vi.mocked(invalidateProfileSummary).mockImplementation(() => {
      throw new Error('x')
    })
    await expect(invalidateProfileSummaryForDiscord('d1')).resolves.toBeUndefined()
  })
})
