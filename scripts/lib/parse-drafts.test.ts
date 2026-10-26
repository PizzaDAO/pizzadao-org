import { describe, it, expect } from 'vitest'
import { parseDraftsMarkdown, platformFromFilename } from './parse-drafts.mjs'

describe('parseDraftsMarkdown', () => {
  it('splits on --- and defaults platform from the filename', () => {
    const md = 'First tweet\n\n---\n\nSecond tweet\nline two\n'
    expect(parseDraftsMarkdown(md, 'devcon.md')).toEqual([
      { platform: 'x', text: 'First tweet', mediaUrl: null, notes: null },
      { platform: 'x', text: 'Second tweet\nline two', mediaUrl: null, notes: null },
    ])
  })
  it('reads meta lines and headings', () => {
    const md = '# Day 1\nplatform: linkedin\nmedia: https://a.io/i.png\n\nBody here\n---\nnotes: n\nOther'
    const [a, b] = parseDraftsMarkdown(md, 'x.md')
    expect(a).toEqual({ platform: 'linkedin', text: 'Body here', mediaUrl: 'https://a.io/i.png', notes: 'Day 1' })
    expect(b.notes).toBe('n')
    expect(b.text).toBe('Other')
  })
  it('uses linkedin from the file name and drops empty sections', () => {
    expect(platformFromFilename('linkedin-follow-campaign.md')).toBe('linkedin')
    expect(parseDraftsMarkdown('---\n\n---\nhi', 'linkedin.md')).toEqual([
      { platform: 'linkedin', text: 'hi', mediaUrl: null, notes: null },
    ])
  })
  it('rejects unknown platforms', () => {
    expect(() => parseDraftsMarkdown('platform: myspace\n\nhi', 'a.md')).toThrow()
  })
})
