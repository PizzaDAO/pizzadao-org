import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'

vi.mock('@/app/ui/shared/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { MissionReviewPanel } from '../MissionReviewPanel'

const base = {
  missionId: 1,
  memberId: null,
  evidence: null,
  notes: null,
  submittedAt: '2026-10-01T00:00:00.000Z',
  accountSignals: [],
}

function mockPending(submissions: unknown[], flagged: unknown[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ submissions, flagged }), { status: 200 })),
  )
}

describe('MissionReviewPanel', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows submitter names (linked with "member #N", or the Discord handle) instead of Discord IDs', async () => {
    mockPending([
      {
        ...base,
        id: 1,
        discordId: '100000000000000001',
        submitter: { name: 'Pizza Pal', discordId: '100000000000000001', memberId: '42' },
        mission: { title: 'Share in #show-and-tell', level: 3, index: 0, description: null },
      },
      {
        ...base,
        id: 2,
        discordId: '420591211007574016',
        source: 'AUTO',
        holdReason: 'HIGH_LEVEL',
        holdLabel: 'Level 6+ needs a human approval',
        checkResult: { roleIds: ['823266914834841610'] },
        checkItems: [{ label: 'Roles', value: 'Pepperoni Mafia' }],
        submitter: { name: 'Held L7', discordId: '420591211007574016', handle: '@heldl7' },
        mission: { title: 'Join Pepperoni Mafia', level: 6, index: 0, description: null },
      },
    ])
    render(<MissionReviewPanel />)
    const names = await screen.findAllByTestId('submitter')
    expect(names[0].textContent).toContain('Pizza Pal')
    expect(names[0].textContent).toContain('member #42')
    expect(within(names[0]).getByRole('link').getAttribute('href')).toBe('/profile/42')
    expect(names[1].textContent).toContain('Held L7')
    expect(names[1].textContent).toContain('@heldl7')
    expect(within(names[1]).queryByRole('link')).toBeNull()

    const saw = screen.getByTestId('verifier-saw')
    expect(saw.textContent).toContain('Roles: Pepperoni Mafia')
    expect(document.body.textContent).not.toContain('420591211007574016')
    expect(document.body.textContent).not.toContain('823266914834841610')
  })

  it('auto-verified holds say "needs approval" and offer Approve, never Release', async () => {
    mockPending([
      {
        ...base,
        id: 3,
        discordId: '100000000000000003',
        holdReason: 'HIGH_LEVEL',
        holdLabel: 'Level 6+ needs a human approval',
        submitter: { name: 'Someone', discordId: '100000000000000003' },
        mission: { title: 'Become a Crew Leader', level: 7, index: 0, description: null },
      },
    ])
    render(<MissionReviewPanel />)
    expect((await screen.findByTestId('awaiting-release')).textContent).toContain('Auto-verified · needs approval')
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /release/i })).toBeNull()
    expect(document.body.textContent).not.toMatch(/release/i)
  })
})
