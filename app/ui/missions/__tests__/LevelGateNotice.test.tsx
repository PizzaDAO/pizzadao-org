import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, fireEvent, cleanup } from '@testing-library/react'
import { renderWithIntl } from '@/app/lib/i18n/test-utils'
import { LevelGateBanner, LevelGateNote, levelGateNoteFor, type LevelGateInfo } from '../LevelGateNotice'

const base: LevelGateInfo = {
  vouchMinLevel: 4,
  boxMinLevel: 5,
  vouch: 'ok',
  box: 'missing',
  heldBack: true,
  earnedLevel: 6,
  boxLink: 'https://opensea.io/collection/rare-pizzas-box',
}

describe('LevelGateNotice', () => {
  afterEach(() => cleanup())

  it('shows a note on level 5+ missions and a vouch note on level 4, none below', () => {
    expect(levelGateNoteFor(base, 3)).toBeNull()
    expect(levelGateNoteFor(base, 4)).toBe('vouch')
    expect(levelGateNoteFor(base, 5)).toBe('box')
    expect(levelGateNoteFor(base, 8)).toBe('box')
  })

  it('level 5 note says a Rare Pizza Box is required', () => {
    renderWithIntl(<LevelGateNote info={base} level={5} />)
    expect(screen.getByText(/Level 5 requires a Rare Pizza Box/)).toBeTruthy()
  })

  it('level 4 note says a vouch is required, and hides once met', () => {
    const { rerender } = renderWithIntl(<LevelGateNote info={{ ...base, vouch: 'missing' }} level={4} />)
    expect(screen.getByText(/Level 4 requires a vouch from another member/)).toBeTruthy()
    rerender(<LevelGateNote info={{ ...base, vouch: 'ok' }} level={4} />)
    expect(screen.queryByTestId('level-gate-note')).toBeNull()
  })

  it('banner lists both requirements, links to get a box and rechecks', () => {
    const onRecheck = vi.fn()
    renderWithIntl(<LevelGateBanner info={base} currentLevel={4} rechecking={false} onRecheck={onRecheck} />)
    expect(screen.getByTestId('gate-vouch').getAttribute('data-state')).toBe('ok')
    expect(screen.getByTestId('gate-box').getAttribute('data-state')).toBe('missing')
    expect(screen.getByTestId('gate-get-box').getAttribute('href')).toBe(base.boxLink)
    fireEvent.click(screen.getByTestId('gate-recheck'))
    expect(onRecheck).toHaveBeenCalled()
  })

  it('banner shows a retry (and no buy link) when the lookup failed', () => {
    renderWithIntl(<LevelGateBanner info={{ ...base, box: 'unknown' }} currentLevel={4} rechecking={false} onRecheck={() => {}} />)
    expect(screen.queryByTestId('gate-get-box')).toBeNull()
    expect(screen.getByTestId('gate-recheck').textContent).toMatch(/Try again/)
  })

  it('banner is hidden when nothing is held back', () => {
    renderWithIntl(<LevelGateBanner info={{ ...base, heldBack: false }} currentLevel={6} rechecking={false} onRecheck={() => {}} />)
    expect(screen.queryByTestId('level-gate-banner')).toBeNull()
  })
})
