import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { HandbookMarkdown, splitHeadingAnchor } from './HandbookMarkdown'

describe('HandbookMarkdown', () => {
  it('uses the trailing {#anchor} as the heading id and hides it from the text', () => {
    const { container } = render(<HandbookMarkdown content={'## Vouching {#vouching}\n\nText.\n\n### Sub {#sub-part}'} />)
    const h2 = container.querySelector('h2')!
    expect(h2.id).toBe('vouching')
    expect(h2.textContent).toBe('Vouching')
    expect(container.querySelector('h3')!.id).toBe('sub-part')
  })

  it('leaves a heading without an anchor alone', () => {
    const { container } = render(<HandbookMarkdown content={'## Plain'} />)
    expect(container.querySelector('h2')!.id).toBe('')
    expect(container.querySelector('h2')!.textContent).toBe('Plain')
  })

  it('opens external links in a new tab safely and keeps internal links internal', () => {
    const { container } = render(<HandbookMarkdown content={'[out](https://example.org/x) and [in](/handbook/levels#vouching)'} />)
    const [out, inn] = Array.from(container.querySelectorAll('a'))
    expect(out.getAttribute('target')).toBe('_blank')
    expect(out.getAttribute('rel')).toBe('noopener noreferrer')
    expect(inn.getAttribute('href')).toBe('/handbook/levels#vouching')
    expect(inn.getAttribute('target')).toBeNull()
  })

  it('does not render raw HTML or javascript: links', () => {
    const { container } = render(<HandbookMarkdown content={'<script>alert(1)</script><b>x</b>\n\n[bad](javascript:alert(1))'} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    const a = container.querySelector('a')
    expect(a?.getAttribute('href') ?? '').not.toMatch(/^javascript:/i)
  })

  it('splitHeadingAnchor reads only a trailing anchor', () => {
    expect(splitHeadingAnchor('Hello {#a-b}')).toMatchObject({ id: 'a-b' })
    expect(splitHeadingAnchor('Hello {#A B}').id).toBeUndefined()
  })
})

describe('HandbookMarkdown hardening', () => {
  it('does not render images', () => {
    const { container } = render(<HandbookMarkdown content={'![alt](https://example.org/x.png) after'} />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('does not treat //host or /\\host as internal links', () => {
    const { container } = render(<HandbookMarkdown content={'[a](//example.org) [b](/\\example.org) [c](/ok)'} />)
    const [a, b, c] = Array.from(container.querySelectorAll('a'))
    expect(a.getAttribute('target')).toBe('_blank')
    expect(b.getAttribute('href') ?? '').not.toContain('\\')
    expect(c.getAttribute('target')).toBeNull()
  })
})
