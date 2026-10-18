// jalapeno-82565 v2 — bounty notifications: recipients and crew-page links.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from './db'

vi.mock('./db')
vi.mock('./crew-leads', () => ({ getCrewLeadMemberIds: vi.fn() }))
vi.mock('./sheets/member-repository', () => ({ fetchMemberById: vi.fn() }))

import { getCrewLeadMemberIds } from './crew-leads'
import { fetchMemberById } from './sheets/member-repository'
import { notifyBountySubmitted, notifyBountyRejected, notifyBountyCompleted, notifyBountyClaimed } from './notifications'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>
const created = () => mockFn(prisma.notification.create).mock.calls.map(([a]) => a.data)

beforeEach(() => {
  vi.clearAllMocks()
  mockFn(prisma.notification.create).mockResolvedValue({})
})

describe('bounty notifications', () => {
  it('submitted: tells the poster and the crew leads, never the claimer, linking to the crew board', async () => {
    mockFn(getCrewLeadMemberIds).mockResolvedValue(new Set(['m1', 'm2']))
    mockFn(fetchMemberById).mockImplementation(async (id: string) => ({ m1: { discordId: 'lead-1' }, m2: { discordId: 'claimer' } } as Record<string, unknown>)[id] ?? null)

    await notifyBountySubmitted('poster', 'claimer', 7, 'Do a thing', 'ops')

    const rows = created()
    expect(rows.map((r) => r.recipientId).sort()).toEqual(['lead-1', 'poster'])
    expect(rows.every((r) => r.type === 'BOUNTY_SUBMITTED' && r.linkUrl === '/crew/ops#bounties')).toBe(true)
  })

  it('submitted: a failing lead lookup still notifies the poster', async () => {
    mockFn(getCrewLeadMemberIds).mockRejectedValue(new Error('sheet down'))
    await notifyBountySubmitted('poster', 'claimer', 7, 'Do a thing', 'ops')
    expect(created().map((r) => r.recipientId)).toEqual(['poster'])
  })

  it('submitted: a general bounty links to /pep and skips the lead lookup', async () => {
    await notifyBountySubmitted('poster', 'claimer', 7, 'Do a thing', null)
    expect(getCrewLeadMemberIds).not.toHaveBeenCalled()
    expect(created()[0].linkUrl).toBe('/pep')
  })

  it('rejected: goes to the claimer with the note', async () => {
    await notifyBountyRejected('claimer', 'lead', 7, 'Do a thing', 'Add tests', 'ops')
    const [row] = created()
    expect(row).toMatchObject({ type: 'BOUNTY_REJECTED', recipientId: 'claimer', actorId: 'lead', linkUrl: '/crew/ops#bounties' })
    expect(row.message).toContain('Add tests')
  })

  it('completed: the claimer is paid-notified, and the poster too when someone else approved', async () => {
    await notifyBountyCompleted('claimer', 'lead', 7, 'Do a thing', 50, 'ops', 'poster')
    expect(created().map((r) => r.recipientId).sort()).toEqual(['claimer', 'poster'])
  })

  it('completed: no duplicate when the poster approved', async () => {
    await notifyBountyCompleted('claimer', 'poster', 7, 'Do a thing', 50, null, 'poster')
    expect(created().map((r) => r.recipientId)).toEqual(['claimer'])
    expect(created()[0].linkUrl).toBe('/pep')
  })

  it('claimed: links to the crew board for crew bounties', async () => {
    await notifyBountyClaimed('poster', 'claimer', 7, 'Do a thing', 'ops')
    expect(created()[0].linkUrl).toBe('/crew/ops#bounties')
  })
})
