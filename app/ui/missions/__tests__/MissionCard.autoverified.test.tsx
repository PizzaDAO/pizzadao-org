import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { screen, cleanup } from '@testing-library/react'
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
