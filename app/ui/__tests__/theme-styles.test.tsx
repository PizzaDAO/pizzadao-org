import { describe, it, expect } from 'vitest'
import { card, btn, input, pageContainer, tile, overlay } from '../shared-styles'

describe('shared-styles use CSS variables', () => {
  it('card() uses CSS variables', () => {
    const styles = card()
    expect(styles.background).toBe('var(--color-surface)')
    expect(styles.color).toBe('var(--color-text)')
    expect(styles.border).toContain('var(--color-border)')
    expect(styles.boxShadow).toContain('var(--shadow-card)')
  })

  it('btn("primary") uses CSS variables', () => {
    const styles = btn('primary')
    expect(styles.background).toBe('var(--color-btn-primary-bg)')
    expect(styles.color).toBe('var(--color-btn-primary-text)')
  })

  it('btn("secondary") uses CSS variables', () => {
    const styles = btn('secondary')
    expect(styles.background).toBe('var(--color-btn-secondary-bg)')
    expect(styles.color).toBe('var(--color-btn-secondary-text)')
  })

  it('input() uses CSS variables', () => {
    const styles = input()
    expect(styles.background).toBe('var(--color-input-bg)')
    expect(styles.color).toBe('var(--color-input-text)')
    expect(styles.border).toContain('var(--color-input-border)')
  })

  it('pageContainer() uses CSS variables', () => {
    const styles = pageContainer()
    expect(styles.background).toBe('var(--color-page-bg)')
    expect(styles.color).toBe('var(--color-text)')
  })

  it('tile() uses CSS variables', () => {
    const selected = tile(true)
    const unselected = tile(false)
    expect(selected.background).toContain('var(--color')
    expect(unselected.background).toContain('var(--color')
  })

  it('overlay() uses CSS variables', () => {
    const styles = overlay()
    expect(styles.background).toBe('var(--color-overlay)')
  })
})
