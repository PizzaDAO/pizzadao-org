import { describe, it, expect } from 'vitest'
import { card, btn, input, pageContainer, tile, overlay } from '../shared-styles'

// buffalo-69872 (Restyle Phase 1): the back-compat `--color-*` token aliases
// in globals.css still drive shared-styles.ts. Phase 2 will migrate these
// primitives onto the new semantic tokens (--background, --foreground,
// --primary, etc.); this test should be rewritten then to assert against
// `hsl(var(--card))`, `hsl(var(--primary))`, etc.
describe('shared-styles use theme CSS variables', () => {
  it('card() uses theme CSS variables', () => {
    const styles = card()
    expect(styles.background).toContain('var(--color-')
    expect(styles.color).toContain('var(--color-')
    expect(styles.border).toContain('var(--color-')
    expect(styles.boxShadow).toContain('var(--shadow-')
  })

  it('btn("primary") uses theme CSS variables', () => {
    const styles = btn('primary')
    expect(styles.background).toContain('var(--color-')
    expect(styles.color).toContain('var(--color-')
  })

  it('btn("secondary") uses theme CSS variables', () => {
    const styles = btn('secondary')
    expect(styles.background).toContain('var(--color-')
    expect(styles.color).toContain('var(--color-')
  })

  it('input() uses theme CSS variables', () => {
    const styles = input()
    expect(styles.background).toContain('var(--color-')
    expect(styles.color).toContain('var(--color-')
    expect(styles.border).toContain('var(--color-')
  })

  it('pageContainer() uses theme CSS variables', () => {
    const styles = pageContainer()
    expect(styles.background).toContain('var(--color-')
    expect(styles.color).toContain('var(--color-')
  })

  it('tile() uses theme CSS variables', () => {
    const selected = tile(true)
    const unselected = tile(false)
    expect(selected.background).toContain('var(--color')
    expect(unselected.background).toContain('var(--color')
  })

  it('overlay() uses theme CSS variables', () => {
    const styles = overlay()
    expect(styles.background).toContain('var(--color-')
  })
})
