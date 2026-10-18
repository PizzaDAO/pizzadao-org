// jalapeno-82565 v2 — crew-lead detection and bounty permissions. Fails closed.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./crew-mappings', () => ({ getCrewMappings: vi.fn() }))
vi.mock('./crew-sheet', () => ({ CREW_SHEET_REVALIDATE_SECONDS: 60, fetchCrewRoster: vi.fn() }))
vi.mock('./member-utils', () => ({ findMemberIdByDiscordId: vi.fn() }))
vi.mock('./auth-guards', () => ({ isAdminDiscordId: vi.fn() }))

import { isLeadStatus, getCrewLeadMemberIds, isCrewLead, canManageCrew, canManageBounty } from './crew-leads'
import { getCrewMappings } from './crew-mappings'
import { fetchCrewRoster } from './crew-sheet'
import { findMemberIdByDiscordId } from './member-utils'
import { isAdminDiscordId } from './auth-guards'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockFn(getCrewMappings).mockResolvedValue({
    cached: true,
    crews: [
      { id: 'ops', label: 'Ops', sheet: 'https://docs.google.com/spreadsheets/d/x/edit' },
      { id: 'nosheet', label: 'No Sheet' },
    ],
  })
  mockFn(fetchCrewRoster).mockResolvedValue([
    { id: 'm1', status: 'Lead' },
    { id: 'm2', status: 'Active' },
    { id: 'm3', status: 'Iced lead' },
    { id: 'm4', status: 'Capo' },
    { id: '', status: 'Lead' },
  ])
  mockFn(findMemberIdByDiscordId).mockImplementation(
    async (d: string) => ({ d1: 'm1', d2: 'm2', d3: 'm3', d4: 'm4' } as Record<string, string>)[d] ?? null,
  )
  mockFn(isAdminDiscordId).mockResolvedValue(false)
})

describe('isLeadStatus', () => {
  it.each([
    ['Lead', true],
    ['Crew Lead', true],
    ['capo', true],
    ['Iced lead', false],
    ['Inactive capo', false],
    ['Active', false],
    ['', false],
    [undefined, false],
  ])('%j -> %s', (status, expected) => {
    expect(isLeadStatus(status as string | undefined)).toBe(expected)
  })
})

describe('getCrewLeadMemberIds', () => {
  it('returns member ids with a lead/capo status, skipping iced and id-less rows', async () => {
    expect(await getCrewLeadMemberIds('ops')).toEqual(new Set(['m1', 'm4']))
  })
  it('is empty for a crew without a sheet or an unknown crew', async () => {
    expect((await getCrewLeadMemberIds('nosheet')).size).toBe(0)
    expect((await getCrewLeadMemberIds('nope')).size).toBe(0)
  })
})

describe('isCrewLead (fails closed)', () => {
  it('true for a lead, false for a non-lead', async () => {
    expect(await isCrewLead('d1', 'ops')).toBe(true)
    expect(await isCrewLead('d2', 'ops')).toBe(false)
    expect(await isCrewLead('d3', 'ops')).toBe(false)
  })
  it('false when the Discord user has no member row, or no crew is given', async () => {
    expect(await isCrewLead('ghost', 'ops')).toBe(false)
    expect(await isCrewLead('d1', null)).toBe(false)
    expect(await isCrewLead('', 'ops')).toBe(false)
  })
  it('false when the sheet or the member lookup throws', async () => {
    mockFn(fetchCrewRoster).mockRejectedValue(new Error('down'))
    expect(await isCrewLead('d1', 'ops')).toBe(false)
    mockFn(fetchCrewRoster).mockResolvedValue([{ id: 'm1', status: 'Lead' }])
    mockFn(findMemberIdByDiscordId).mockRejectedValue(new Error('down'))
    expect(await isCrewLead('d1', 'ops')).toBe(false)
  })
})

describe('canManageCrew / canManageBounty', () => {
  it('a lead or an admin can manage the crew; others cannot; an admin check error fails closed', async () => {
    expect(await canManageCrew('d1', 'ops')).toBe(true)
    expect(await canManageCrew('d2', 'ops')).toBe(false)
    mockFn(isAdminDiscordId).mockResolvedValue(true)
    expect(await canManageCrew('d2', 'ops')).toBe(true)
    mockFn(isAdminDiscordId).mockRejectedValue(new Error('discord'))
    expect(await canManageCrew('d2', 'ops')).toBe(false)
  })

  it('the poster always can, without touching the sheet', async () => {
    expect(await canManageBounty('poster', { createdBy: 'poster', crewId: 'ops' })).toBe(true)
    expect(fetchCrewRoster).not.toHaveBeenCalled()
  })
  it('a crew lead can for a bounty of their crew only', async () => {
    expect(await canManageBounty('d1', { createdBy: 'poster', crewId: 'ops' })).toBe(true)
    expect(await canManageBounty('d1', { createdBy: 'poster', crewId: null })).toBe(false)
    expect(await canManageBounty('d2', { createdBy: 'poster', crewId: 'ops' })).toBe(false)
  })
  it('an admin can for any bounty', async () => {
    mockFn(isAdminDiscordId).mockResolvedValue(true)
    expect(await canManageBounty('boss', { createdBy: 'poster', crewId: null })).toBe(true)
  })
})
