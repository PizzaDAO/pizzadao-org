import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/app/lib/i18n/test-utils'
import { GuideLink, HowLevelsWorkLink } from './GuideLink'
import { LevelUpModal } from './LevelUpModal'

describe('mission guide links', () => {
  it('GuideLink points at the stored path, in every language', () => {
    for (const [locale, text] of [['en', 'How to do this'], ['es', 'Cómo hacerlo'], ['fr', 'Comment faire']] as const) {
      const { unmount } = renderWithIntl(<GuideLink href="/handbook/levels#vouching" />, { locale })
      expect(screen.getByRole('link', { name: text }).getAttribute('href')).toBe('/handbook/levels#vouching')
      unmount()
    }
  })

  it('a completed mission shows the link muted, not hidden', () => {
    renderWithIntl(<GuideLink href="/handbook/levels" muted />)
    expect(screen.getByTestId('mission-guide-link').style.opacity).toBe('0.7')
  })

  it('HowLevelsWorkLink goes to the levels chapter', () => {
    renderWithIntl(<HowLevelsWorkLink />)
    expect(screen.getByRole('link', { name: 'How levels work' }).getAttribute('href')).toBe('/handbook/levels')
  })
})

describe('LevelUpModal what next link', () => {
  it('links to the new level in the levels chapter', () => {
    renderWithIntl(<LevelUpModal level={4} levelTitle="T" reward={10} onDismiss={() => {}} />)
    expect(screen.getByTestId('level-up-whats-next').getAttribute('href')).toBe('/handbook/levels#level-4')
  })

  it('has no link on the final level', () => {
    renderWithIntl(<LevelUpModal level={8} levelTitle="T" reward={10} onDismiss={() => {}} isFinal />)
    expect(screen.queryByTestId('level-up-whats-next')).toBeNull()
  })
})
