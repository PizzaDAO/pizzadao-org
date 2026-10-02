import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, fireEvent, cleanup } from '@testing-library/react'
import { renderWithIntl } from '@/app/lib/i18n/test-utils'
import { ProfileCompleteCelebration } from '../ProfileCompleteCelebration'

const STEPS = ['Join a crew', 'Connect a wallet', 'Connect X']

function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? matches : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

describe('ProfileCompleteCelebration', () => {
  it('renders an accessible, labelled modal dialog with the ticked steps', () => {
    mockReducedMotion(false)
    renderWithIntl(<ProfileCompleteCelebration stepLabels={STEPS} onDismiss={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: /you.re all set up/i })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    for (const s of STEPS) expect(screen.getByText(s)).toBeTruthy()
  })

  it('moves focus to the primary button on open and restores it on close', () => {
    mockReducedMotion(false)
    const opener = document.createElement('button')
    opener.textContent = 'opener'
    document.body.appendChild(opener)
    opener.focus()

    const { unmount } = renderWithIntl(
      <ProfileCompleteCelebration stepLabels={STEPS} onDismiss={() => {}} />,
    )
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /nice/i }))
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.activeElement).toBe(opener)
    expect(document.body.style.overflow).toBe('')
    opener.remove()
  })

  it('traps Tab / Shift+Tab inside the dialog', () => {
    mockReducedMotion(false)
    renderWithIntl(
      <ProfileCompleteCelebration stepLabels={STEPS} profileHref="/profile/42" onDismiss={() => {}} />,
    )
    const nice = screen.getByRole('button', { name: /nice/i })
    const link = screen.getByRole('link', { name: /view your profile/i })

    link.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(nice)

    nice.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(link)
  })

  it('dismisses on Escape, on the button, and on the backdrop — not on card clicks', () => {
    mockReducedMotion(false)
    const onDismiss = vi.fn()
    renderWithIntl(<ProfileCompleteCelebration stepLabels={STEPS} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('dialog'))
    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /nice/i }))
    expect(onDismiss).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByTestId('profile-complete-celebration'))
    expect(onDismiss).toHaveBeenCalledTimes(3)
  })

  it('renders confetti normally but none under prefers-reduced-motion', () => {
    mockReducedMotion(false)
    const { unmount } = renderWithIntl(
      <ProfileCompleteCelebration stepLabels={STEPS} onDismiss={() => {}} />,
    )
    expect(screen.getAllByTestId('profile-confetti-piece').length).toBeGreaterThan(0)
    unmount()

    mockReducedMotion(true)
    renderWithIntl(<ProfileCompleteCelebration stepLabels={STEPS} onDismiss={() => {}} />)
    expect(screen.queryAllByTestId('profile-confetti-piece')).toHaveLength(0)
  })
})
