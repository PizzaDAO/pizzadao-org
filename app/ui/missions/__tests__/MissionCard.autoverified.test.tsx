import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { renderWithIntl } from '@/app/lib/i18n/test-utils'
import { MissionCard } from '../MissionCard'

const mission = {
  id: 53,
  index: 3,
  title: 'Own a Rare Pizza Box',
  description: 'Hold a Rare Pizza Box NFT.',
  autoChecked: true,
  proofKind: 'NONE',
  progress: null,
}

describe('MissionCard: automatic missions with nothing to submit', () => {
  afterEach(() => cleanup())

  it('has no submit button when the mission is noManualSubmit', () => {
    renderWithIntl(<MissionCard mission={{ ...mission, noManualSubmit: true }} levelUnlocked onSubmit={async () => {}} />)
    expect(screen.queryByRole('button', { name: /submit|mark|complete/i })).toBeNull()
    expect(screen.getByText(/Checked automatically/)).toBeTruthy()
  })

  it('shows where to get a Rare Pizza Box', () => {
    renderWithIntl(
      <MissionCard
        mission={{ ...mission, noManualSubmit: true, getBoxUrl: 'https://opensea.io/collection/rare-pizzas-box' }}
        levelUnlocked
        onSubmit={async () => {}}
      />,
    )
    expect(screen.getByTestId('mission-get-box').querySelector('a')?.getAttribute('href')).toBe('https://opensea.io/collection/rare-pizzas-box')
  })

  it('marks a mission added to an already paid level as an optional bonus', () => {
    renderWithIntl(<MissionCard mission={{ ...mission, noManualSubmit: true }} levelUnlocked bonus onSubmit={async () => {}} />)
    expect(screen.getByTestId('mission-bonus').textContent).toMatch(/optional/)
  })

  it('no bonus note on a normal open mission', () => {
    renderWithIntl(<MissionCard mission={mission} levelUnlocked onSubmit={async () => {}} />)
    expect(screen.queryByTestId('mission-bonus')).toBeNull()
  })
})

describe('MissionCard: vouch link on "Get vouched by N members"', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })
  const vouchMission = { ...mission, id: 70, title: 'Get vouched by 5 members', noManualSubmit: true, vouchLink: { need: 5, have: 2 } }

  it('shows the public profile link, progress, copy and share for the signed-in member', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ enabled: false }) })))
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    renderWithIntl(<MissionCard mission={vouchMission} memberId="42" levelUnlocked onSubmit={async () => {}} />)
    expect(screen.getByText(/Your vouch link/)).toBeTruthy()
    expect(screen.getByTestId('mission-vouch-url').textContent).toMatch(/^https?:\/\/.+\/profile\/42$/)
    expect(screen.getByTestId('mission-vouch-progress').textContent).toBe('2 of 5 vouches')
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/profile\/42$/)))
    expect(screen.getByRole('button', { name: /share/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /ask a member/i })).toBeNull()
  })

  it('offers "Ask a member" only when vouch requests are enabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ enabled: true }) })))
    renderWithIntl(<MissionCard mission={vouchMission} memberId="42" levelUnlocked onSubmit={async () => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /ask a member/i }))
    expect(await screen.findByLabelText(/ask a member to vouch/i)).toBeTruthy()
  })

  it('is hidden for signed-out viewers and anonymous mission data', () => {
    renderWithIntl(<MissionCard mission={vouchMission} levelUnlocked onSubmit={async () => {}} />)
    expect(screen.queryByTestId('mission-vouch-link')).toBeNull()
  })
})
