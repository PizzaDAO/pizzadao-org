import { describe, it, expect } from 'vitest'
import { card, btn, input, pageContainer, tile, overlay, navBtn, badge, loadingSpinner } from '../shared-styles'

// truffle-11395 (Restyle Phase 2): shared-styles now consume the new
// semantic HSL tokens (`--background`, `--foreground`, `--primary`, `--card`,
// `--rule`, `--tomato`, `--ring`, `--radius`) directly via `hsl(var(--token))`,
// matching pizzadao.org's convention. Phase 1's back-compat `--color-*`
// aliases in globals.css are no longer touched by the primitives themselves
// (page-level files still consume them; Phase 3+ will migrate those).
describe('shared-styles consume Phase 1 semantic HSL tokens', () => {
  it('card() uses --card / --card-foreground / --rule + --radius', () => {
    const styles = card()
    expect(styles.background).toBe('hsl(var(--card))')
    expect(styles.color).toBe('hsl(var(--card-foreground))')
    expect(String(styles.border)).toContain('hsl(var(--rule)')
    expect(styles.borderRadius).toBe('var(--radius)')
    // Subtle ink-tinted shadow, no legacy --shadow-card alias.
    expect(String(styles.boxShadow)).toContain('hsl(var(--ink)')
  })

  it('btn("primary") uses --primary / --primary-foreground', () => {
    const styles = btn('primary')
    expect(styles.background).toBe('hsl(var(--primary))')
    expect(styles.color).toBe('hsl(var(--primary-foreground))')
    expect(styles.borderRadius).toBe('var(--radius)')
  })

  it('btn("secondary") uses --secondary / --secondary-foreground', () => {
    const styles = btn('secondary')
    expect(styles.background).toBe('hsl(var(--secondary))')
    expect(styles.color).toBe('hsl(var(--secondary-foreground))')
  })

  it('btn("accent") uses --tomato / --cream (loud brand CTA)', () => {
    const styles = btn('accent')
    expect(styles.background).toBe('hsl(var(--tomato))')
    expect(styles.color).toBe('hsl(var(--cream))')
  })

  it('btn(kind, disabled=true) drops opacity to 0.5 and disables cursor', () => {
    const styles = btn('primary', true)
    expect(styles.opacity).toBe(0.5)
    expect(styles.cursor).toBe('not-allowed')
  })

  it('input() uses --background / --foreground / --rule', () => {
    const styles = input()
    expect(styles.background).toBe('hsl(var(--background))')
    expect(styles.color).toBe('hsl(var(--foreground))')
    expect(String(styles.border)).toContain('hsl(var(--rule)')
    expect(styles.borderRadius).toBe('var(--radius)')
  })

  it('pageContainer() uses --background / --foreground', () => {
    const styles = pageContainer()
    expect(styles.background).toBe('hsl(var(--background))')
    expect(styles.color).toBe('hsl(var(--foreground))')
  })

  it('tile(selected) highlights with tomato border + tinted background', () => {
    const selected = tile(true)
    const unselected = tile(false)
    expect(String(selected.border)).toContain('hsl(var(--tomato))')
    expect(String(selected.background)).toContain('hsl(var(--tomato)')
    expect(String(unselected.border)).toContain('hsl(var(--rule)')
    expect(unselected.background).toBe('hsl(var(--card))')
  })

  it('overlay() uses ink at 50% for the scrim', () => {
    const styles = overlay()
    expect(String(styles.background)).toContain('hsl(var(--ink) / 0.5)')
  })

  it('navBtn() uses --card surface with rule border', () => {
    const styles = navBtn()
    expect(styles.background).toBe('hsl(var(--card))')
    expect(String(styles.border)).toContain('hsl(var(--rule)')
  })

  it('badge() default uses --muted + --foreground; accent uses tomato wash', () => {
    const def = badge()
    expect(def.background).toBe('hsl(var(--muted))')
    expect(def.color).toBe('hsl(var(--foreground))')

    const accent = badge('accent')
    expect(String(accent.background)).toContain('hsl(var(--tomato)')
    expect(accent.color).toBe('hsl(var(--tomato))')
  })

  it('loadingSpinner() uses ink track + tomato active color', () => {
    const styles = loadingSpinner()
    expect(String(styles.border)).toContain('hsl(var(--ink)')
    expect(String(styles.borderTop)).toContain('hsl(var(--tomato))')
  })
})
