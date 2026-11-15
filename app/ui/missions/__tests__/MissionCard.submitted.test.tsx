import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { screen, cleanup } from '@testing-library/react'
import { renderWithIntl } from '@/app/lib/i18n/test-utils'
import { MissionCard } from '../MissionCard'

const vouch = {
  id: 70,
  index: 1,
  title: 'Get vouched by 5 members',
  description: null,
  autoChecked: true,
  noManualSubmit: true,
  vouchLink: { need: 5, have: 5 },
}
const pending = (holdReason: string | null) => ({
  ...vouch,
  progress: { status: 'PENDING', submittedAt: '2026-11-01T00:00:00Z', holdReason },
})

describe('MissionCard: submitted and waiting for review', () => {
  afterEach(() => cleanup())

  it('says a held completion is submitted and waiting, and explains the hold', () => {
    renderWithIntl(<MissionCard mission={pending('HIGH_LEVEL')} memberId="42" levelUnlocked humanReleaseMinLevel={6} onSubmit={async () => {}} />)
    const box = screen.getByTestId('mission-submitted')
    expect(box.textContent).toContain('Submitted — waiting for review')
    expect(box.textContent).toContain('Level 6+')
    expect(screen.getByText('Submitted')).toBeTruthy()
  })

  it('stops inviting more vouches once the completion is submitted', () => {
    renderWithIntl(<MissionCard mission={pending('HIGH_LEVEL')} memberId="42" levelUnlocked onSubmit={async () => {}} />)
    expect(screen.queryByText(/Your vouch link/)).toBeNull()
  })

  it('shows the same banner for a plain pending completion', () => {
    renderWithIntl(<MissionCard mission={pending(null)} levelUnlocked onSubmit={async () => {}} />)
    expect(screen.getByTestId('mission-submitted').textContent).toContain('Submitted — waiting for review')
  })

  it('is translated', () => {
    renderWithIntl(<MissionCard mission={pending('NEW_ACCOUNT')} levelUnlocked onSubmit={async () => {}} />, { locale: 'es' })
    expect(screen.getByTestId('mission-submitted').textContent).toContain('Enviada — esperando revisión')
    cleanup()
    renderWithIntl(<MissionCard mission={pending('NEW_ACCOUNT')} levelUnlocked onSubmit={async () => {}} />, { locale: 'fr' })
    expect(screen.getByTestId('mission-submitted').textContent).toContain('Envoyée — en attente de relecture')
  })

  it('shows nothing of the kind for an approved or open mission', () => {
    renderWithIntl(<MissionCard mission={{ ...vouch, progress: { status: 'APPROVED', submittedAt: '2026-11-01T00:00:00Z' } }} levelUnlocked onSubmit={async () => {}} />)
    expect(screen.queryByTestId('mission-submitted')).toBeNull()
  })
})
